import type { DimsSource } from "@/lib/types";

/**
 * Peso y medidas del bulto de envío (migración 0023 de vigi-api).
 *
 * Se guarda en gramos y centímetros enteros, que es lo que piden Andreani y
 * Correo Argentino. En el panel se escribe en kg y cm con decimales, como
 * vienen en las fichas, y se redondea **para arriba**: cotizar un bulto un
 * poco más grande cuesta centavos; uno más chico, la diferencia entera.
 */

export const DIMS_SOURCE_LABEL: Record<DimsSource, string> = {
  official: "Ficha oficial",
  meli: "MercadoLibre",
  manual: "Manual",
};

/** "1,25" o "1.25" → 1.25. Vacío o inválido → null. */
export const leerNumero = (v: string): number | null => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

export const kgAGramos = (kg: number) => Math.max(1, Math.ceil(kg * 1000));
export const aCmEntero = (cm: number) => Math.max(1, Math.ceil(cm));

/** "20×25×35 cm · 3,5 kg" */
export const describirBulto = (b: {
  weight_grams: number;
  height_cm: number;
  width_cm: number;
  length_cm: number;
}) =>
  `${b.height_cm}×${b.width_cm}×${b.length_cm} cm · ${(b.weight_grams / 1000).toLocaleString("es-AR", {
    maximumFractionDigits: 2,
  })} kg`;

/**
 * Búsqueda de la ficha técnica del fabricante. Una búsqueda y no la web de
 * cada marca: con "datasheet" casi siempre el primer resultado es el PDF
 * oficial, y no hay que mantener un mapa de URLs que cambian.
 */
export const fichaOficialUrl = (model: string, provider?: string | null) =>
  `https://www.google.com/search?q=${encodeURIComponent(
    [provider, `"${model}"`, "datasheet"].filter(Boolean).join(" ")
  )}`;
