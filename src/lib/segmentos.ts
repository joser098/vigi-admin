/**
 * Segmentos de clientes.
 *
 * Quién entra en cada uno lo decide la base (`customer_overview()`, migración
 * 0022 de vigi-api), no el panel: marketing-send usa la misma función para
 * elegir a quién mandarle, así que lo que se ve acá es lo que recibe el mail.
 * Esto es solo el nombre y la explicación de cada uno.
 */

export type SegmentoId =
  | "recurrentes"
  | "una_compra"
  | "dormidos"
  | "sin_compra"
  | "carrito_abierto"
  | "con_favoritos"
  | "vip";

export const SEGMENTOS: Record<
  SegmentoId,
  { label: string; descripcion: string; tone: "green" | "amber" | "red" | "violet" | "neutral" }
> = {
  vip: {
    label: "VIP",
    descripcion: "El 10% que más gastó.",
    tone: "violet",
  },
  recurrentes: {
    label: "Recurrentes",
    descripcion: "Compraron 2 veces o más.",
    tone: "green",
  },
  una_compra: {
    label: "Una compra",
    descripcion: "Compraron una sola vez: los más fáciles de hacer volver.",
    tone: "neutral",
  },
  dormidos: {
    label: "Dormidos",
    descripcion: "Compraron, pero hace más de 90 días que no vuelven.",
    tone: "red",
  },
  sin_compra: {
    label: "Sin compra",
    descripcion: "Se registraron y nunca compraron.",
    tone: "neutral",
  },
  carrito_abierto: {
    label: "Carrito abierto",
    descripcion: "Tienen productos en el carrito ahora.",
    tone: "amber",
  },
  con_favoritos: {
    label: "Con favoritos",
    descripcion: "Guardaron productos: sabemos qué les interesa.",
    tone: "violet",
  },
};

export const SEGMENTO_IDS = Object.keys(SEGMENTOS) as SegmentoId[];

export const esSegmento = (v: string | null | undefined): v is SegmentoId =>
  !!v && v in SEGMENTOS;
