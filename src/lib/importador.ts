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
  /** Las specs del proveedor ("Bullet | Lente 2.8mm | IR 30m"), si la fila las trae. */
  descripcion: string | null;
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
    let descripcion: string | null = null;

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
        continue;
      }

      // Lo que sí tiene pinta de descripción se guarda para el alta de
      // productos nuevos. No hace falta para actualizar costos.
      if (!descripcion && (v.includes("|") || v.length > 40)) descripcion = v;
    }

    if (!modelo || costo == null) return;

    // Una lista puede repetir un modelo (aparece en "novedades" y en su
    // sección). Se queda la primera, que es la que el proveedor destaca.
    const clave = normalizar(modelo);
    if (!clave || vistos.has(clave)) return;
    vistos.add(clave);

    items.push({ modelo, costo, descripcion, linea: i + 1 });
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
  /**
   * "exacta"   un solo producto con ese modelo normalizado
   * "nuevo"    ninguno: el proveedor lo vende y nosotros no
   * "ambiguo"  más de uno: lo tiene que resolver una persona
   */
  tipo: "exacta" | "nuevo" | "ambiguo";
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
    if (candidatos.length === 0) {
      return { item, producto: null, tipo: "nuevo" as const };
    }
    if (candidatos.length > 1) {
      return { item, producto: null, tipo: "ambiguo" as const };
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

// ---------------------------------------------------------------------------
// Disponibilidad: lo que el proveedor dejó de listar, y lo que volvió
// ---------------------------------------------------------------------------

/**
 * La marca de la pestaña pegada. El CSV no la dice, así que se deduce de los
 * productos que sí cruzaron: la marca que más se repite. Es una sugerencia, la
 * pantalla deja cambiarla.
 */
export const marcaProbable = (coincidencias: Coincidencia[]): string | null => {
  const cuenta = new Map<string, number>();

  for (const c of coincidencias) {
    const m = c.producto?.provider;
    if (m) cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }

  let mejor: string | null = null;
  for (const [m, n] of cuenta) {
    if (mejor == null || n > (cuenta.get(mejor) ?? 0)) mejor = m;
  }

  return mejor;
};

/**
 * Productos visibles de la marca que no aparecen en la lista.
 *
 * Que no estén no prueba que el proveedor no los tenga: la marca puede estar
 * repartida en más de una pestaña (Hikvision tiene dos), o el modelo puede
 * estar escrito distinto. Por eso es una lista para revisar, no algo que se
 * aplique solo.
 */
export const faltantes = (
  items: ItemLista[],
  productos: Product[],
  marca: string
): Product[] => {
  const enLista = new Set(items.map((i) => normalizar(i.modelo)));

  return productos.filter(
    (p) =>
      p.is_active &&
      p.provider === marca &&
      !enLista.has(normalizar(p.model))
  );
};

/** Productos ocultos que la lista vuelve a traer: el proveedor los repuso. */
export const reaparecidos = (coincidencias: Coincidencia[]): Coincidencia[] =>
  coincidencias.filter((c) => c.producto != null && !c.producto.is_active);

// ---------------------------------------------------------------------------
// Alta de productos nuevos
// ---------------------------------------------------------------------------

/**
 * Misma heurística que vigi-api/db/import/import-catalogue.js: la descripción
 * del proveedor es bastante consistente para adivinar la categoría. Es solo el
 * valor inicial del selector.
 */
export const adivinarCategoria = (modelo: string, descripcion: string | null) => {
  const t = `${modelo} ${descripcion ?? ""}`.toLowerCase();

  if (/^kit/.test(modelo.toLowerCase())) return "kits";
  if (/\b\d+\s*ch\b/.test(t) || /decodificaci/.test(t) || /\b(nvr|xvr|dvr)\b/.test(t))
    return "grabadores";
  if (/\b(bullet|domo|varifocal|ptz|fisheye)\b/.test(t) || /lente\s/.test(t) || /\bir\s*\d+\s*m/.test(t))
    return "camaras";
  if (/\b(ssd|hdd|disco|microsd|pendrive|memoria)\b/.test(t)) return "almacenamiento";
  if (/\b(router|switch|access\s*point|repetidor|mesh)\b/.test(t)) return "redes";

  return null;
};

const ubicacion = (texto: string): Product["location"] => {
  const t = texto.toLowerCase();
  const ext = /\bexterior\b/.test(t);
  const int = /\binterior\b/.test(t);

  if (ext && !int) return "exterior";
  if (int && !ext) return "interior";
  return null;
};

/**
 * La fila a insertar. Entra OCULTO: sin fotos ni revisión no tiene que
 * aparecer en la tienda. Se activa desde el detalle cuando la ficha está lista.
 * El precio lo pone el trigger a partir del costo y el margen por defecto.
 */
export const productoNuevo = (
  item: ItemLista,
  marca: string,
  categoria: string
) => {
  const modelo = item.modelo.trim();
  const texto = `${modelo} ${item.descripcion ?? ""}`;
  const specs = (item.descripcion ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    model: modelo,
    title: `${marca} ${modelo}`,
    description: item.descripcion,
    provider: marca,
    category: categoria,
    cost: item.costo,
    is_active: false,
    location: ubicacion(texto),
    tags: [categoria],
    details: { specs },
  };
};

// ---------------------------------------------------------------------------
// El sheet
// ---------------------------------------------------------------------------

/** La lista del proveedor, la misma que lee vigi-api/db/import/import-catalogue.js. */
export const SHEET_PROVEEDOR =
  import.meta.env.VITE_PROVEEDOR_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1iu-qsCOJ9FsHdajPlHr06FjFyfwsotRfRX2dtGFWit8/edit";
