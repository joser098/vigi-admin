// Comisión de la pasarela de pago. No es un dato del producto sino del medio
// de pago (Mercado Pago cobra ~7% por procesar), así que no vive en la base:
// es una preferencia del panel, compartida por el listado y el detalle para
// que los dos muestren el mismo número.

const KEY = "vigi.comision_pct";
const DEFECTO = 7;

export const getComision = () => {
  const v = Number(localStorage.getItem(KEY));
  return Number.isFinite(v) && v >= 0 ? v : DEFECTO;
};

export const setComision = (v: number) => localStorage.setItem(KEY, String(v));

// La comisión se cobra sobre lo que paga el cliente, no sobre el costo.
export const comisionMonto = (precio: number | null, pct: number) =>
  precio == null ? null : Math.round((precio * pct) / 100);

export const gananciaNeta = (
  costo: number | null,
  precio: number | null,
  pct: number
) => {
  if (costo == null || precio == null) return null;
  return precio - costo - (comisionMonto(precio, pct) ?? 0);
};

// Lo que queda en el bolsillo sobre el costo, ya descontada la comisión.
// Es el número que decide si conviene vender o no.
export const margenNeto = (
  costo: number | null,
  precio: number | null,
  pct: number
) => {
  const g = gananciaNeta(costo, precio, pct);
  if (g == null || !costo) return null;
  return Math.round((g / costo) * 100);
};
