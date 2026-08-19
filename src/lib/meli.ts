/**
 * Link al listado público de MercadoLibre para un producto.
 *
 * La API de búsqueda de MercadoLibre está cerrada: `/sites/MLA/search`
 * responde 403 aun con un token válido, por política de ellos. Así que en vez
 * de traer el precio, llevamos al listado y el precio se carga a mano.
 *
 * MercadoLibre acepta la búsqueda como slug en la URL:
 *   https://listado.mercadolibre.com.ar/c3tn-ezviz
 */
export const meliSearchUrl = (
  model: string,
  provider?: string | null
): string => {
  const slug = [model, provider]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    // Todo lo que no sea letra o número separa palabras: los modelos vienen
    // con puntos, barras y guiones (DS-2CE76K0T-EXLPF, KITD8+4).
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `https://listado.mercadolibre.com.ar/${slug}`;
};
