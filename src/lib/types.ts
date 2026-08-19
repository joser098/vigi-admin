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
  updated_at: string;
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
