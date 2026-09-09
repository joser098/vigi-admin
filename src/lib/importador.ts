import type { Product } from "@/lib/types";
import { gananciaNeta } from "@/lib/comision";

/**
 * Importador de la lista de precios del proveedor.
 *
 * La lista llega como el CSV que exporta cada pestaña del Google Sheet
 * ("TODO-SEGURIDAD ldp"), una pestaña por marca. Ese CSV no es una tabla
 * limpia: la primera columna son imágenes, hay filas de encabezado, banners de
 * promoción y celdas combinadas. Por eso no se parsea por posición de fila sino
 * por forma: **toda fila que tenga algo parecido a un modelo y algo parecido a
 * un precio es un ítem; el resto se descarta.**
 *
 * Lo que se importa es el COSTO, no el precio de venta. `products.cost` tiene un
 * trigger detrás (migración 0005) que recalcula `price` con el margen del
 * producto, salvo que tenga `price_override`. O sea: actualizar el costo
 * reajusta el precio solo, que es justamente para lo que se pensó el esquema.
 */

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Parser de CSV con comillas dobles, al estilo RFC 4180. */
export const parsearCSV = (texto: string): string[][] => {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') enComillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }

  if (campo || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
};

/**
 * Un precio del sheet: "$348.000", "348.000", "$ 1.194.000".
 *
 * El punto es separador de miles, no decimal — es una lista argentina. Se
 * descartan los valores absurdos: una celda con "2026" o "4CH" no es un precio.
 */
const PRECIO_MINIMO = 1000;

export const leerPrecio = (celda: string): number | null => {
  const limpio = String(celda ?? "").trim();
  if (!limpio) return null;
  if (!/\d/.test(limpio)) return null;
  // Con letras adentro no es un precio ("HD hasta 10TB", "4CH").
  if (/[a-zA-Z]/.test(limpio.replace(/^\s*\$\s*/, ""))) return null;

  const n = Number(limpio.replace(/[^\d]/g, ""));
  if (!Number.isFinite(n) || n < PRECIO_MINIMO) return null;

  return n;
};

export type ItemLista = {
  modelo: string;
  costo: number;
  /** Fila del CSV, para poder señalar dónde estaba si algo no cuadra. */
  linea: number;
};

/**
 * Saca los ítems de la lista.
 *
 * No se fija en qué columna está cada cosa: recorre la fila y toma la primera
 * celda que parece un modelo y la primera que parece un precio. Así sobrevive a
 * que el proveedor agregue o mueva una columna, que pasa seguido.
 */
export const leerLista = (csv: string): ItemLista[] => {
  const items: ItemLista[] = [];
  const vistos = new Set<string>();

  parsearCSV(csv).forEach((fila, i) => {
    let modelo = "";
    let costo: number | null = null;

    for (const celda of fila) {
      const v = String(celda ?? "").trim();
      if (!v) continue;

      const precio = leerPrecio(v);

      if (precio != null) {
        if (costo == null) costo = precio;
        continue;
      }

      // Candidato a modelo: corto, con al menos una letra o número, y sin
      // pinta de descripción (las descripciones traen "|" y son largas).
      if (!modelo && v.length <= 40 && !v.includes("|") && /[a-zA-Z0-9]/.test(v)) {
        modelo = v;
      }
    }

    if (!modelo || costo == null) return;

    // Una lista puede repetir un modelo (aparece en "novedades" y en su
    // sección). Se queda la primera, que es la que el proveedor destaca.
    const clave = normalizar(modelo);
    if (!clave || vistos.has(clave)) return;
    vistos.add(clave);

    items.push({ modelo, costo, linea: i + 1 });
  });

  return items;
};

// ---------------------------------------------------------------------------
// Coincidencia con el catálogo
// ---------------------------------------------------------------------------

/**
 * Los modelos del sheet y los de la base casi coinciden, pero no del todo:
 * "BM1-Ra" vs "BM1-RA", "RANGER 2 4MP " con espacio al final, "CB2 1080P"
 * contra "CB2 1080P". Se normaliza para comparar: mayúsculas, sin acentos y
 * sin nada que no sea letra o número.
 */
export const normalizar = (s: string) =>
  String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");

export type Coincidencia = {
  item: ItemLista;
  producto: Product | null;
  /** "exacta" cuando los modelos normalizados son iguales; "sin match" cuando no hubo. */
  tipo: "exacta" | "sin match";
};

export const cruzar = (items: ItemLista[], productos: Product[]): Coincidencia[] => {
  const porModelo = new Map<string, Product[]>();

  for (const p of productos) {
    const k = normalizar(p.model);
    if (!k) continue;
    const lista = porModelo.get(k) ?? [];
    lista.push(p);
    porModelo.set(k, lista);
  }

  return items.map((item) => {
    const candidatos = porModelo.get(normalizar(item.modelo)) ?? [];

    // Con más de un producto para el mismo modelo no se adivina: se deja sin
    // match para que lo resuelva una persona. Cambiar el precio del producto
    // equivocado en una tienda viva no se nota hasta que alguien compra.
    if (candidatos.length !== 1) {
      return { item, producto: null, tipo: "sin match" as const };
    }

    return { item, producto: candidatos[0], tipo: "exacta" as const };
  });
};

// ---------------------------------------------------------------------------
// Qué pasaría si se aplica
// ---------------------------------------------------------------------------

/** El precio que va a quedar, replicando el trigger `set_product_price`. */
export const precioResultante = (p: Product, costoNuevo: number) =>
  p.price_override != null
    ? Number(p.price_override)
    : Math.round(costoNuevo * (1 + Number(p.margin_pct) / 100));

/** Y el precio que ve el cliente, con la promoción aplicada (columna generada). */
export const precioEfectivoResultante = (p: Product, costoNuevo: number) => {
  const precio = precioResultante(p, costoNuevo);
  const d = Number(p.discount);

  return p.has_promotion && d >= 1 && d <= 50
    ? Math.floor(precio - (precio * d) / 100)
    : precio;
};

export type Cambio = {
  producto: Product;
  item: ItemLista;
  costoViejo: number | null;
  costoNuevo: number;
  /** Diferencia de costo en porcentaje. null cuando no había costo cargado. */
  variacionPct: number | null;
  precioViejo: number;
  precioNuevo: number;
  gananciaVieja: number | null;
  gananciaNueva: number | null;
  /** El precio no se mueve porque está fijado a mano: el margen se lo come el costo. */
  congelado: boolean;
  /** Quedaría vendiéndose por debajo del costo más la comisión. */
  aPerdida: boolean;
};

export const calcularCambios = (
  coincidencias: Coincidencia[],
  comisionPct: number
): Cambio[] =>
  coincidencias
    .filter((c): c is Coincidencia & { producto: Product } => c.producto != null)
    .map(({ item, producto }) => {
      const costoViejo = producto.cost == null ? null : Number(producto.cost);
      const costoNuevo = item.costo;

      const precioViejo = Number(producto.effective_price);
      const precioNuevo = precioEfectivoResultante(producto, costoNuevo);

      const gananciaNueva = gananciaNeta(costoNuevo, precioNuevo, comisionPct);

      return {
        producto,
        item,
        costoViejo,
        costoNuevo,
        variacionPct:
          costoViejo && costoViejo > 0
            ? Math.round(((costoNuevo - costoViejo) / costoViejo) * 1000) / 10
            : null,
        precioViejo,
        precioNuevo,
        gananciaVieja: gananciaNeta(costoViejo, precioViejo, comisionPct),
        gananciaNueva,
        congelado: producto.price_override != null,
        aPerdida: gananciaNueva != null && gananciaNueva <= 0,
      };
    })
    // Lo que no cambia no se muestra: la lista trae cientos de ítems y casi
    // todos vienen igual que la última vez.
    .filter((c) => c.costoViejo == null || c.costoNuevo !== c.costoViejo);
