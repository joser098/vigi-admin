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
