import type { PaymentOrder } from "./types";

/**
 * Leer un pago sin importar de qué procesador venga.
 *
 * `payment_orders` guarda unas pocas columnas propias y mete la respuesta
 * completa del procesador en `raw`. Mercado Pago y Nave no comparten ni la
 * forma ni los nombres, así que todo lo que la pantalla necesita se normaliza
 * acá y no en el JSX: si mañana se suma un procesador, se toca este archivo.
 *
 * Todo devuelve `null` cuando el dato no está. Un pago viejo, uno de otra
 * pasarela o uno rechazado a mitad de camino tienen huecos, y la pantalla los
 * muestra como "—" en vez de romperse.
 */

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const esMP = (p: PaymentOrder) => p.gateway === "mercadopago";

/** Lo que pagó el cliente. */
export const bruto = (p: PaymentOrder) =>
  num(p.transaction_details?.total_paid_amount) ??
  num(p.raw?.transaction_amount) ??
  num(p.amount);

/**
 * Lo que queda después de la comisión del procesador. Es el número que
 * importa: `amount` es lo que pagó el cliente, no lo que entra a la cuenta.
 */
export const neto = (p: PaymentOrder) =>
  num(p.transaction_details?.net_received_amount) ?? num(p.raw?.transaction_details?.net_received_amount);

/** Comisión cobrada por el procesador, en pesos. */
export const comision = (p: PaymentOrder) => {
  const detalles = p.raw?.fee_details;
  if (Array.isArray(detalles) && detalles.length) {
    return detalles.reduce((t: number, f: any) => t + (num(f.amount) ?? 0), 0);
  }

  // Si no vino el desglose, se deduce de la diferencia.
  const b = bruto(p);
  const n = neto(p);
  return b != null && n != null ? b - n : null;
};

/** La comisión como porcentaje de lo cobrado. */
export const comisionPct = (p: PaymentOrder) => {
  const b = bruto(p);
  const c = comision(p);
  return b && c != null ? (c / b) * 100 : null;
};

export const cuotas = (p: PaymentOrder) => num(p.raw?.installments);

export const tarjeta = (p: PaymentOrder) => {
  const card = p.card ?? p.raw?.card;
  if (!card?.last_four_digits) return null;

  return {
    ultimos4: String(card.last_four_digits),
    primeros6: card.first_six_digits ? String(card.first_six_digits) : null,
    vence:
      card.expiration_month && card.expiration_year
        ? `${String(card.expiration_month).padStart(2, "0")}/${card.expiration_year}`
        : null,
    titular: card.cardholder?.name ?? null,
  };
};

/** Marca y tipo, en castellano. */
export const medioDePago = (p: PaymentOrder) => {
  const tipo = String(p.payment_method?.type ?? p.raw?.payment_type_id ?? "");
  const marca = p.payment_method?.id ?? p.raw?.payment_method_id ?? null;

  const etiqueta = tipo.includes("debit")
    ? "Débito"
    : tipo.includes("credit")
      ? "Crédito"
      : tipo.includes("prepaid")
        ? "Prepaga"
        : tipo.includes("account_money")
          ? "Dinero en cuenta"
          : tipo || null;

  return { etiqueta, marca: marca ? String(marca).toUpperCase() : null };
};

export const emailPagador = (p: PaymentOrder) =>
  p.payer?.email ?? p.raw?.payer?.email ?? null;

export const items = (p: PaymentOrder): Array<{ title: string; quantity: number; unit_price: number }> => {
  const crudos = Array.isArray(p.items) && p.items.length ? p.items : p.raw?.additional_info?.items;
  if (!Array.isArray(crudos)) return [];

  return crudos.map((i: any) => ({
    title: i.title ?? i.name ?? "—",
    quantity: num(i.quantity) ?? 1,
    unit_price: num(i.unit_price) ?? 0,
  }));
};

/**
 * `live_mode: false` es un pago de prueba. Vale la pena marcarlo fuerte: un
 * pago de test mezclado en la lista de ventas reales desordena cualquier
 * cuenta que se haga mirando esta pantalla.
 */
export const esPrueba = (p: PaymentOrder) => p.raw?.live_mode === false;

export const refunds = (p: PaymentOrder): any[] =>
  Array.isArray(p.raw?.refunds) ? p.raw.refunds : [];

/** Estados de los dos procesadores, en castellano y con un color. */
export const estado = (p: PaymentOrder) => {
  const s = String(p.status ?? "").toLowerCase();

  if (["approved", "accredited"].includes(s))
    return { label: "Aprobado", tone: "green" as const };
  if (["rejected", "cancelled", "canceled", "failed"].includes(s))
    return { label: s === "rejected" ? "Rechazado" : "Cancelado", tone: "red" as const };
  if (["refunded", "charged_back"].includes(s))
    return { label: s === "refunded" ? "Devuelto" : "Contracargo", tone: "violet" as const };
  if (["created", "pending", "in_process", "authorized"].includes(s))
    return { label: s === "created" ? "Iniciado" : "Pendiente", tone: "amber" as const };

  return { label: p.status ?? "—", tone: "neutral" as const };
};

/**
 * El motivo del rechazo, traducido. Son los mismos códigos que ve el cliente en
 * la tienda; acá sirven para contestar un "por qué no me pasó la tarjeta".
 */
const MOTIVOS: Record<string, string> = {
  accredited: "Acreditado",
  pending_contingency: "En revisión por Mercado Pago",
  pending_review_manual: "En revisión manual",
  cc_rejected_insufficient_amount: "Fondos insuficientes",
  cc_rejected_bad_filled_card_number: "Número de tarjeta mal cargado",
  cc_rejected_bad_filled_date: "Vencimiento mal cargado",
  cc_rejected_bad_filled_security_code: "Código de seguridad incorrecto",
  cc_rejected_bad_filled_other: "Datos de la tarjeta mal cargados",
  cc_rejected_high_risk: "Rechazado por prevención de fraude",
  cc_rejected_call_for_authorize: "El banco pide autorización del titular",
  cc_rejected_card_disabled: "Tarjeta inhabilitada para compras online",
  cc_rejected_max_attempts: "Máximo de intentos alcanzado",
  cc_rejected_duplicated_payment: "Pago duplicado",
  cc_rejected_card_error: "Error al procesar la tarjeta",
  cc_rejected_blacklist: "Tarjeta en lista negra",
};

export const motivo = (p: PaymentOrder) =>
  p.status_detail ? (MOTIVOS[p.status_detail] ?? p.status_detail) : null;
