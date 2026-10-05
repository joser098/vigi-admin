// Precios de reventa. Por ahora es una mesa de trabajo para ver números, no una
// lista publicada: la configuración (niveles, descuentos, piso) es una
// preferencia del panel, como la comisión, y no vive en la base. Cuando haya
// que compartir la lista con revendedores se mueve a una tabla para que los
// precios salgan siempre del costo actual y no de un archivo viejo.
//
// La reventa se cobra por transferencia, así que acá no hay comisión de
// pasarela: lo que paga el revendedor menos el costo es la ganancia entera.

export type Nivel = {
  id: string;
  nombre: string;
  // Descuento sobre el precio público de la tienda.
  descuento: number;
  // Compra mínima por pedido, en pesos.
  minimo: number;
};

export type ConfigReventa = {
  // Ganancia mínima sobre el costo. Ningún nivel puede vender por debajo.
  piso: number;
  niveles: Nivel[];
};

const KEY = "vigi.reventa";

export const CONFIG_DEFECTO: ConfigReventa = {
  piso: 20,
  niveles: [
    { id: "instalador", nombre: "Instalador", descuento: 10, minimo: 500_000 },
    { id: "revendedor", nombre: "Revendedor", descuento: 15, minimo: 1_000_000 },
    { id: "distribuidor", nombre: "Distribuidor", descuento: 20, minimo: 3_000_000 },
  ],
};

// Lo guardado lo escribe el propio panel, pero puede venir de una versión
// anterior o estar roto: ante cualquier duda, los valores por defecto.
export const getConfig = (): ConfigReventa => {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      c &&
      Number.isFinite(c.piso) &&
      Array.isArray(c.niveles) &&
      c.niveles.length > 0 &&
      c.niveles.every(
        (n: Nivel) =>
          typeof n.id === "string" &&
          typeof n.nombre === "string" &&
          Number.isFinite(n.descuento) &&
          Number.isFinite(n.minimo)
      )
    ) {
      return c;
    }
  } catch {
    // JSON roto: se ignora.
  }
  return CONFIG_DEFECTO;
};

export const setConfig = (c: ConfigReventa) => localStorage.setItem(KEY, JSON.stringify(c));

// El precio más bajo al que se puede vender sin bajar del piso.
export const precioPiso = (costo: number, piso: number) => Math.ceil(costo * (1 + piso / 100));

// El descuento más grande sobre el precio público que todavía respeta el
// piso. Es el número que dice qué nivel "entra" en cada producto. Puede ser
// negativo: el precio público ya está por debajo del piso.
export const descuentoMaximo = (costo: number, publico: number, piso: number) =>
  publico > 0 ? (1 - precioPiso(costo, piso) / publico) * 100 : null;

export type PrecioNivel = {
  // Lo que paga el revendedor.
  precio: number;
  // Lo que ganamos nosotros, sobre el costo.
  ganancia: number;
  margen: number;
  // El descuento del nivel bajaba del piso y el precio quedó en el piso.
  // El revendedor recibe menos descuento que el anunciado en este producto.
  topeado: boolean;
  // Lo que gana el revendedor si vende al precio público, sobre lo que pagó.
  margenRevendedor: number;
};

/**
 * Precio de un producto para un nivel. El descuento se aplica sobre el precio
 * público y, si deja la ganancia por debajo del piso, el precio sube al piso:
 * nunca se publica un precio que no cuide la ganancia mínima.
 */
export const precioNivel = (
  costo: number,
  publico: number,
  descuento: number,
  piso: number
): PrecioNivel => {
  const conDescuento = Math.round(publico * (1 - descuento / 100));
  const minimo = precioPiso(costo, piso);
  const topeado = conDescuento < minimo;
  const precio = topeado ? minimo : conDescuento;
  const ganancia = precio - costo;

  return {
    precio,
    ganancia,
    margen: costo > 0 ? (ganancia / costo) * 100 : 0,
    topeado,
    margenRevendedor: precio > 0 ? ((publico - precio) / precio) * 100 : 0,
  };
};
