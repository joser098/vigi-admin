import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number, date, dateTime } from "@/lib/format";
import { PageTitle, Stat, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import { SEGMENTOS } from "@/lib/segmentos";
import { nombreCliente } from "@/pages/Clientes";
import type { CustomerExtras, CustomerOverview, OrderStatus } from "@/lib/types";

/**
 * Ficha de un cliente: lo que compró, lo que tiene en el carrito, lo que
 * guardó y qué mails recibió. Es lo que hace falta tener a mano cuando
 * alguien escribe o llama.
 */

type Orden = {
  id: string;
  amount_paid: number;
  discount: number;
  coupon_code: string | null;
  status: string;
  created_at: string;
  order_items: Array<{ name: string; quantity: number }>;
};

type Mail = { fecha: string; que: string; estado: string };

type Contacto = { id: string; is_subscribed: boolean };

const PASOS: Record<number, string> = { 1: "Recordatorio", 2: "Beneficios", 3: "Cupón" };

const ClienteDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const [cliente, setCliente] = useState<CustomerOverview | null>(null);
  const [extras, setExtras] = useState<CustomerExtras | null>(null);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [estados, setEstados] = useState<Record<string, string>>({});
  const [mails, setMails] = useState<Mail[]>([]);
  const [canjes, setCanjes] = useState<Array<{ code: string; amount: number; created_at: string }>>([]);
  const [contacto, setContacto] = useState<Contacto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = async () => {
    const { data: c, error: errC } = await supabase
      .rpc("admin_customers")
      .eq("customer_id", id)
      .maybeSingle();

    if (errC) setError(errC.message);
    if (!c) {
      setCargando(false);
      return;
    }

    const k = c as CustomerOverview;
    setCliente(k);

    const [x, o, s, ms, rs, cj, mc] = await Promise.all([
      supabase.rpc("admin_customer_extras", { p_customer: id }),
      supabase
        .from("orders")
        .select("id, amount_paid, discount, coupon_code, status, created_at, order_items(name, quantity)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("order_statuses").select("*"),
      supabase
        .from("marketing_sends")
        .select("created_at, status, marketing_campaigns(name, subject)")
        .eq("email", k.email)
        .order("created_at", { ascending: false }),
      supabase
        .from("cart_recovery_sends")
        .select("created_at, status, step, discount_pct, error, coupons(code)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("coupon_redemptions")
        .select("amount, created_at, coupons(code)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("marketing_contacts").select("id, is_subscribed").eq("email", k.email).maybeSingle(),
    ]);

    const err = x.error ?? o.error ?? ms.error ?? rs.error ?? cj.error;
    if (err) setError(err.message);

    setExtras((x.data ?? null) as CustomerExtras | null);
    setOrdenes((o.data ?? []) as unknown as Orden[]);
    setEstados(
      Object.fromEntries(((s.data ?? []) as OrderStatus[]).map((e) => [e.code, e.label]))
    );

    // Campañas y recupero de carritos en una sola línea de tiempo.
    const deCampanas: Mail[] = ((ms.data ?? []) as any[]).map((m) => ({
      fecha: m.created_at,
      que: `Campaña: ${m.marketing_campaigns?.name ?? m.marketing_campaigns?.subject ?? "—"}`,
      estado: m.status,
    }));
    const deRecupero: Mail[] = ((rs.data ?? []) as any[]).map((r) => ({
      fecha: r.created_at,
      que:
        `Carrito abandonado ${r.step}/3 · ${PASOS[r.step]}` +
        (r.coupons?.code ? ` · ${r.coupons.code} (${Number(r.discount_pct)}%)` : ""),
      estado: r.status === "skipped" ? `no salió: ${r.error ?? ""}` : r.status,
    }));
    setMails([...deCampanas, ...deRecupero].sort((a, b) => b.fecha.localeCompare(a.fecha)));

    setCanjes(
      ((cj.data ?? []) as any[]).map((r) => ({
        code: r.coupons?.code ?? "—",
        amount: r.amount,
        created_at: r.created_at,
      }))
    );
    setContacto((mc.data ?? null) as Contacto | null);
    setCargando(false);
  };

  useEffect(() => {
    cargar();
  }, [id]);

  // Dar de baja a alguien que lo pidió por teléfono, o volver a darlo de alta
  // si se arrepintió. Es la misma columna que toca el link de baja del mail.
  const cambiarSuscripcion = async () => {
    if (!contacto) return;
    setOcupado(true);

    const nuevo = !contacto.is_subscribed;
    const { error } = await supabase
      .from("marketing_contacts")
      .update({ is_subscribed: nuevo, unsubscribed_at: nuevo ? null : new Date().toISOString() })
      .eq("id", contacto.id);

    setOcupado(false);
    if (error) return setError(error.message);
    await cargar();
  };

  if (cargando) return <Loading />;
  if (!cliente) return <Empty>No existe ese cliente.</Empty>;

  const carrito = extras?.cart?.items ?? [];
  const totalCarrito = carrito
    .filter((i) => i.is_active)
    .reduce((t, i) => t + Number(i.unit_price) * i.quantity, 0);

  return (
    <>
      <Link to="/clientes" className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-900">
        ← Clientes
      </Link>

      <PageTitle
        action={
          contacto && (
            <button className="btn-ghost" disabled={ocupado} onClick={cambiarSuscripcion}>
              {contacto.is_subscribed ? "Darlo de baja de los mails" : "Volver a mandarle mails"}
            </button>
          )
        }
      >
        {nombreCliente(cliente)}
      </PageTitle>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <span>{cliente.email}</span>
        {cliente.phone && <span>· {cliente.phone}</span>}
        {cliente.province && (
          <span>
            · {cliente.location ? `${cliente.location}, ` : ""}
            {cliente.province}
          </span>
        )}
        <span>· cliente desde {date(cliente.register_date)}</span>
        {cliente.is_guest && <Badge>invitado</Badge>}
        {!cliente.is_subscribed && <Badge tone="red">dado de baja</Badge>}
        {cliente.segments.map((s) => (
          <Badge key={s} tone={SEGMENTOS[s].tone}>
            {SEGMENTOS[s].label}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Compras" value={number(cliente.orders_count)} hint={`primera: ${date(cliente.first_order_at)}`} />
        <Stat label="Gastó en total" value={money(cliente.total_spent)} hint="sin cancelados ni reembolsos" />
        <Stat label="Ticket promedio" value={money(cliente.avg_ticket)} />
        <Stat label="Última compra" value={date(cliente.last_order_at)} hint={`última sesión: ${date(cliente.last_login)}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* --- Carrito ---------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="text-sm font-medium">Carrito actual</h2>
          {carrito.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">Vacío.</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-neutral-500">
                Tocado por última vez el {dateTime(extras?.cart?.updated_at)}
              </p>
              <ul className="mt-3 divide-y divide-neutral-100">
                {carrito.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className={i.is_active ? "" : "text-neutral-400 line-through"}>
                      {i.quantity}× {i.title}
                    </span>
                    <span className="tabular whitespace-nowrap">{money(i.unit_price * i.quantity)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-right text-sm font-medium">Total {money(totalCarrito)}</p>
            </>
          )}
        </section>

        {/* --- Favoritos -------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="text-sm font-medium">Favoritos</h2>
          {(extras?.favorites ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">No guardó productos.</p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-100">
              {extras!.favorites.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link to={`/productos/${f.id}`} className={f.is_active ? "hover:underline" : "text-neutral-400"}>
                    {f.title}
                  </Link>
                  <span className="tabular whitespace-nowrap">{money(f.price)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* --- Órdenes -------------------------------------------------------- */}
      <h2 className="mb-3 mt-8 text-sm font-medium">Órdenes</h2>
      {ordenes.length === 0 ? (
        <Empty>Todavía no compró.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Fecha</th>
                <th className="th">Productos</th>
                <th className="th">Estado</th>
                <th className="th text-right">Pagó</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {ordenes.map((o) => (
                <tr key={o.id} className="transition hover:bg-neutral-50">
                  <td className="td whitespace-nowrap">
                    <Link to={`/ordenes/${o.id}`} className="hover:underline">
                      {dateTime(o.created_at)}
                    </Link>
                  </td>
                  <td className="td max-w-sm">
                    <p className="truncate">
                      {o.order_items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                    </p>
                  </td>
                  <td className="td">
                    <Badge>{estados[o.status] ?? o.status}</Badge>
                  </td>
                  <td className="td tabular text-right font-medium">
                    {money(o.amount_paid)}
                    {o.coupon_code && (
                      <p className="text-xs font-normal text-neutral-400">
                        {o.coupon_code} −{money(o.discount)}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* --- Mails ------------------------------------------------------ */}
        <section className="card p-5">
          <h2 className="text-sm font-medium">Mails recibidos</h2>
          {mails.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">Ninguno todavía.</p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-100">
              {mails.map((m, i) => (
                <li key={i} className="py-2 text-sm">
                  <p>{m.que}</p>
                  <p className="text-xs text-neutral-400">
                    {dateTime(m.fecha)} · {m.estado}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Cupones ---------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="text-sm font-medium">Cupones usados</h2>
          {canjes.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">Ninguno.</p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-100">
              {canjes.map((c, i) => (
                <li key={i} className="flex justify-between py-2 text-sm">
                  <span className="font-mono text-xs">{c.code}</span>
                  <span className="tabular">
                    −{money(c.amount)} <span className="text-neutral-400">· {date(c.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
};

export default ClienteDetalle;
