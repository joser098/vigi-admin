import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, dateTime } from "@/lib/format";
import { PageTitle, Badge, Loading, ErrorBox, Empty } from "@/components/ui";
import type { Order, OrderStatus, Customer } from "@/lib/types";

const OrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [orden, setOrden] = useState<Order | null>(null);
  const [cliente, setCliente] = useState<Customer | null>(null);
  const [pago, setPago] = useState<Record<string, any> | null>(null);
  const [estados, setEstados] = useState<OrderStatus[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", id)
      .maybeSingle();

    if (error) setError(error.message);
    if (!data) { setCargando(false); return; }

    const o = data as unknown as Order;
    setOrden(o);

    const [c, p, s] = await Promise.all([
      supabase.from("customers").select("*, addresses(*)").eq("id", o.customer_id).maybeSingle(),
      supabase.from("payment_orders").select("*").eq("gateway_payment_id", o.payment_id).maybeSingle(),
      supabase.from("order_statuses").select("*").order("sort_order"),
    ]);

    setCliente((c.data ?? null) as Customer | null);
    setPago((p.data ?? null) as Record<string, any> | null);
    setEstados((s.data ?? []) as OrderStatus[]);
    setCargando(false);
  };

  useEffect(() => { cargar(); }, [id]);

  const cambiarEstado = async (status: string) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) { setError(error.message); return; }
    await cargar();
  };

  if (cargando) return <Loading />;
  if (!orden) return <Empty>No se encontró la orden.</Empty>;

  const direccion = cliente?.addresses?.[0];
  const items = orden.order_items ?? [];
  const subtotal = items.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);
  const envio = Number(orden.amount_paid) - subtotal;

  return (
    <>
      <Link to="/ordenes" className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-900">
        ← Órdenes
      </Link>

      <PageTitle
        action={
          <select
            value={orden.status}
            onChange={(e) => cambiarEstado(e.target.value)}
            className="input max-w-[12rem]"
          >
            {estados.map((e) => (
              <option key={e.code} value={e.code}>{e.label}</option>
            ))}
          </select>
        }
      >
        Orden {orden.payment_id}
      </PageTitle>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <div className="border-b border-neutral-200 px-5 py-3.5">
            <h2 className="text-sm font-medium">Productos</h2>
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-neutral-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="td">{i.name}</td>
                  <td className="td tabular w-20 text-right text-neutral-500">×{i.quantity}</td>
                  <td className="td tabular w-32 text-right">{money(i.unit_price)}</td>
                  <td className="td tabular w-32 text-right font-medium">
                    {money(Number(i.unit_price) * i.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-neutral-200 bg-neutral-50">
              <tr>
                <td className="td text-neutral-500" colSpan={3}>Subtotal</td>
                <td className="td tabular text-right">{money(subtotal)}</td>
              </tr>
              {envio > 0 && (
                <tr>
                  <td className="td text-neutral-500" colSpan={3}>Envío</td>
                  <td className="td tabular text-right">{money(envio)}</td>
                </tr>
              )}
              <tr>
                <td className="td font-medium" colSpan={3}>Total</td>
                <td className="td tabular text-right text-base font-semibold">
                  {money(orden.amount_paid)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-4 text-sm font-medium">Cliente</h2>
            {cliente ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-neutral-400">Nombre</dt>
                  <dd>{cliente.name} {cliente.last_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-400">Correo</dt>
                  <dd className="break-all">{cliente.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-400">Teléfono</dt>
                  <dd>{cliente.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-400">DNI</dt>
                  <dd>{cliente.dni ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-neutral-400">Sin datos.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-medium">Envío</h2>
            {direccion ? (
              <p className="text-sm leading-relaxed text-neutral-700">
                {direccion.address_name} {direccion.address_number}
                {direccion.department ? ` ${direccion.department}` : ""}
                <br />
                {direccion.location}, {direccion.province}
                <br />
                <span className="text-neutral-400">CP {direccion.zip_code}</span>
              </p>
            ) : (
              <p className="text-sm text-neutral-400">Sin dirección.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-medium">Pago</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-400">Pasarela</dt>
                <dd>{pago?.gateway ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-400">Estado</dt>
                <dd>{pago ? <Badge tone={pago.status === "approved" ? "green" : "amber"}>{pago.status}</Badge> : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-400">Método</dt>
                <dd>{pago?.payment_method?.type ?? pago?.payment_method?.id ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-400">Aprobado</dt>
                <dd className="text-right">{dateTime(pago?.date_approved)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-400">Creada</dt>
                <dd className="text-right">{dateTime(orden.created_at)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
};

export default OrderDetail;
