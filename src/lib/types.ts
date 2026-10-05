import type { SegmentoId } from "./segmentos";

export type Product = {
  id: string;
  model: string;
  title: string;
  description: string | null;
  provider: string | null;
  category: string;
  thumbnail: string | null;
  gallery: number;
  tags: string[];
  cost: number | null;
  margin_pct: number;
  price_override: number | null;
  price: number;
  effective_price: number;
  discount: number;
  has_promotion: boolean;
  is_active: boolean;
  location: "interior" | "exterior" | null;
  power_type: string | null;
  is_analogue: boolean;
  details: Record<string, unknown> | null;
  // Referencia de MercadoLibre, traída a demanda desde el detalle.
  meli_price: number | null;
  meli_url: string | null;
  meli_title: string | null;
  meli_checked_at: string | null;
  // Bulto de envío propio (migración 0023). Las cuatro o ninguna: NULL = usar
  // el perfil de la categoría.
  weight_grams: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  dims_source: DimsSource | null;
  dims_url: string | null;
  dims_checked_at: string | null;
  updated_at: string;
};

export type DimsSource = "official" | "meli" | "manual";

export type ShippingProfile = {
  id: string;
  name: string;
  weight_grams: number;
  height_cm: number;
  width_cm: number;
  length_cm: number;
  notes: string | null;
};

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
};

export type Order = {
  id: string;
  payment_id: string;
  customer_id: string;
  amount_paid: number;
  // Snapshot del cupón usado, congelado al crearse la orden.
  discount: number;
  coupon_code: string | null;
  status: string;
  ip_address: string | null;
  // Seguimiento del envío (migración 0024). Lo usa el mail de "En camino".
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  created_at: string;
  order_items?: OrderItem[];
  customers?: Customer | null;
};

export type Customer = {
  id: string;
  username: string;
  email: string;
  name: string;
  last_name: string;
  phone: string | null;
  dni: string | null;
  addresses?: Address[];
};

export type Address = {
  province: string;
  location: string;
  address_name: string;
  address_number: string;
  department: string | null;
  zip_code: string;
};

export type OrderStatus = {
  code: string;
  label: string;
  sort_order: number;
  is_terminal: boolean;
};

// Cupones de descuento. `redemptions` es un contador que mantiene un trigger a
// partir de coupon_redemptions: la base no deja escribirlo desde el panel.
export type Coupon = {
  id: string;
  code: string;
  description: string | null;
  kind: "percentage" | "fixed";
  value: number;
  max_discount: number | null;
  min_purchase: number;
  max_redemptions: number | null;
  max_per_customer: number | null;
  redemptions: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  // NULL = público. Con valor, cupón personal de ese cliente (recupero de
  // carritos): el panel no los crea.
  customer_id: string | null;
  origin: "manual" | "cart_recovery";
  created_at: string;
  updated_at: string;
};

export type CouponRedemption = {
  id: string;
  coupon_id: string;
  customer_id: string | null;
  order_id: string | null;
  amount: number;
  created_at: string;
  customers?: Pick<Customer, "name" | "last_name" | "email"> | null;
};

/**
 * Una orden de pago tal como la guarda la API.
 *
 * Las columnas de arriba son las que vale la pena consultar; `raw` es la
 * respuesta completa del procesador y su forma cambia según cuál sea. Todo lo
 * que la pantalla necesita leer de ahí pasa por `lib/pagos.ts`, que normaliza
 * las diferencias entre Mercado Pago y Nave.
 */
export type PaymentOrder = {
  id: string;
  gateway: "mercadopago" | "nave";
  gateway_payment_id: string | null;
  gateway_order_id: string | null;
  customer_id: string | null;
  status: string;
  status_detail: string | null;
  amount: number | null;
  payer: Record<string, any> | null;
  items: any[] | null;
  payment_method: Record<string, any> | null;
  transaction_details: Record<string, any> | null;
  card?: Record<string, any> | null;
  raw?: Record<string, any> | null;
  date_approved: string | null;
  created_at: string;
  customers?: Pick<Customer, "name" | "last_name" | "email"> | null;
};

export type MarketingContact = {
  id: string;
  email: string;
  name: string | null;
  source: string;
  is_subscribed: boolean;
  unsubscribed_at: string | null;
  // Listas armadas a mano (migración 0027 de vigi-api).
  lists: string[];
  // false = entró solo por una lista y no recibe las campañas a "Todos".
  in_general: boolean;
  created_at: string;
};

export type MarketingCampaign = {
  id: string;
  name: string;
  subject: string;
  from_name: string | null;
  html: string;
  status: "draft" | "sending" | "sent" | "failed";
  // NULL = todos los suscriptos. Ver lib/segmentos.ts.
  segment: SegmentoId | null;
  // Lista armada a mano. Excluyente con `segment`.
  list: string | null;
  sent_at: string | null;
  sent_count: number;
  failed_count: number;
  created_at: string;
};

// --- MercadoLibre -----------------------------------------------------------
// Las escribe la Edge Function `meli-listings`. El panel edita solo título,
// categoría, cantidad, tipo de publicación, atributos y la configuración.

export type MeliSettings = {
  margin_pct: number;
  taxes_pct: number;
  listing_type_id: "gold_special" | "gold_pro";
  default_quantity: number;
  free_shipping_min: number;
  shipping_cost: number;
  rounding: number;
  vat: string;
  warranty_time: string;
  catalog_min_margin_pct: number;
  installments: MeliCuotas;
  updated_at: string;
};

// Cuotas sin interés: none = Clásica, 3x = Premium + campaña de 3 cuotas,
// 6x = Premium (6 cuotas por defecto).
export type MeliCuotas = "none" | "3x" | "6x";

export type MeliListingStatus =
  | "draft"
  | "ready"
  | "error"
  | "active"
  | "paused"
  | "closed"
  | "under_review"
  | "inactive";

export type MeliListing = {
  id: string;
  product_id: string;
  meli_item_id: string | null;
  status: MeliListingStatus;
  title: string | null;
  category_id: string | null;
  category_name: string | null;
  listing_type_id: string | null;
  quantity: number | null;
  attributes: Record<string, string>;
  price: number | null;
  cost_basis: number | null;
  fee_amount: number | null;
  shipping_cost: number | null;
  taxes_amount: number | null;
  net_profit: number | null;
  quoted_at: string | null;
  errors: unknown;
  permalink: string | null;
  sold_quantity: number;
  synced_at: string | null;
  // Publicación de catálogo (migración 0018).
  catalog_product_id: string | null;
  catalog_item_id: string | null;
  catalog_status: string | null;
  catalog_price: number | null;
  price_to_win: number | null;
  catalog_min_price: number | null;
  catalog_checked_at: string | null;
  // NULL = la de la configuración.
  installments: MeliCuotas | null;
  // Fotos del catálogo de ML para esta publicación, por id. NULL = la galería.
  pictures: Array<{ id: string; url?: string }> | null;
  updated_at: string;
};

// --- Carritos abandonados ---------------------------------------------------
// Migración 0021 de vigi-api. Los mails los manda la Edge Function
// `cart-recovery`; el panel configura, mira y prueba.

export type CartRecoverySettings = {
  is_active: boolean;
  step1_hours: number;
  step2_hours: number;
  step3_hours: number;
  gateway_fee_pct: number;
  min_net_margin_pct: number;
  max_discount_pct: number;
  min_discount_pct: number;
  coupon_valid_hours: number;
  coupon_cooldown_days: number;
  daily_limit: number;
  max_cart_age_days: number;
  updated_at: string;
};

export type OpenCartItem = {
  id: string;
  model: string;
  title: string;
  thumbnail: string | null;
  quantity: number;
  unit_price: number;
  price_original: number | null;
};

/** Una fila de `admin_cart_recovery_open_carts()`. */
export type OpenCart = {
  cart_id: string;
  customer_id: string;
  email: string;
  name: string | null;
  last_name: string | null;
  cart_updated_at: string;
  units: number;
  amount: number;
  // NULL si algún producto no tiene costo cargado.
  cost: number | null;
  items: OpenCartItem[];
  last_step: number | null;
  last_sent_at: string | null;
  next_step: number | null;
  due: boolean;
  unsubscribed: boolean;
  coupon_blocked: boolean;
  margin_before_pct: number | null;
  // NULL = el margen no aguanta el descuento mínimo (o falta el costo).
  discount_pct: number | null;
  discount_amount: number | null;
  margin_after_pct: number | null;
};

/** Una fila de `admin_cart_recovery_episodes`. */
export type RecoveryEpisode = {
  cart_id: string;
  cart_updated_at: string;
  customer_id: string | null;
  email: string;
  name: string | null;
  last_name: string | null;
  cart_amount: number;
  margin_before_pct: number | null;
  last_step: number | null;
  first_sent_at: string | null;
  last_activity_at: string;
  coupon_id: string | null;
  coupon_code: string | null;
  coupon_ends_at: string | null;
  discount_pct: number | null;
  discount_amount: number | null;
  margin_after_pct: number | null;
  had_failures: boolean;
  order_id: string | null;
  order_amount: number | null;
  order_discount: number | null;
  order_created_at: string | null;
  used_coupon: boolean;
};

// --- Clientes ---------------------------------------------------------------

/** Una fila de `admin_customers()` (migración 0022). */
export type CustomerOverview = {
  customer_id: string;
  email: string;
  name: string | null;
  last_name: string | null;
  phone: string | null;
  is_guest: boolean;
  register_date: string;
  last_login: string | null;
  province: string | null;
  location: string | null;
  orders_count: number;
  total_spent: number;
  avg_ticket: number | null;
  first_order_at: string | null;
  last_order_at: string | null;
  cart_units: number;
  cart_amount: number;
  cart_updated_at: string | null;
  favorites: number;
  is_subscribed: boolean;
  segments: SegmentoId[];
};

/** Lo que devuelve `admin_customer_extras(id)`. */
export type CustomerExtras = {
  cart: {
    updated_at: string;
    items: Array<{
      id: string;
      model: string;
      title: string;
      thumbnail: string | null;
      quantity: number;
      unit_price: number;
      is_active: boolean;
    }>;
  } | null;
  favorites: Array<{
    id: string;
    model: string;
    title: string;
    thumbnail: string | null;
    price: number;
    is_active: boolean;
    added_at: string;
  }>;
};
