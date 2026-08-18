import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number, dateTime } from "@/lib/format";
import { PageTitle, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import type { Order, OrderStatus } from "@/lib/types";

const tono = (code: string) =>
  code === "entregado" ? "green" : code === "enviado" ? "violet" : "amber";

const Orders = () => {
  const [ordenes, setOrdenes] = useState<Order[]>([]);
  const [estados, setEstados] = useState<OrderStatus[]>([]);
  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [o, s] = await Promise.all([
        supabase
          .from("orders")
          .select("id,payment_id,customer_id,amount_paid,status,created_at,customers(name,last_name,email)")
          .order("created_at", { ascending: false }),
        supabase.from("order_statuses").select("*").order("sort_order"),
      ]);

      if (o.error ?? s.error) setError((o.error ?? s.error)!.message);

      setOrdenes((o.data ?? []) as unknown as Order[]);
      setEstados((s.data ?? []) as OrderStatus[]);
      setCargando(false);
    })();
  }, []);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return ordenes.filter((o) => {
      if (filtro && o.status !== filtro) return false;
      if (!q) return true;

      const c = o.customers;
      const texto = `${o.payment_id} ${c?.name ?? ""} ${c?.last_name ?? ""} ${c?.email ?? ""}`.toLowerCase();
      return texto.includes(q);
    });
  }, [ordenes, filtro, busqueda]);

  if (cargando) return <Loading />;

  const label = (code: string) => estados.find((e) => e.code === code)?.label ?? code;

  return (
    <>
      <PageTitle
        action={<span className="text-sm text-neutral-500">{number(filtradas.length)} órdenes</span>}
      >
        Órdenes
      </PageTitle>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nº de pago o cliente…"
          className="input max-w-xs"
        />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="input max-w-[11rem]">
          <option value="">Todos los estados</option>
          {estados.map((e) => (
            <option key={e.code} value={e.code}>{e.label}</option>
          ))}
        </select>
      </div>

      {filtradas.length === 0 ? (
        <Empty>
          {ordenes.length === 0
            ? "Todavía no hay órdenes."
            : "No hay órdenes que coincidan."}
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Fecha</th>
                <th className="th">Nº de pago</th>
                <th className="th">Cliente</th>
                <th className="th">Estado</th>
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtradas.map((o) => (
                <tr key={o.id} className="transition hover:bg-neutral-50">
                  <td className="td whitespace-nowrap text-neutral-500">{dateTime(o.created_at)}</td>
                  <td className="td">
                    <Link to={`/ordenes/${o.id}`} className="font-medium text-neutral-900 hover:underline">
                      {o.payment_id}
                    </Link>
                  </td>
                  <td className="td">
                    {o.customers ? (
                      <>
                        {o.customers.name} {o.customers.last_name}
                        <p className="text-xs text-neutral-400">{o.customers.email}</p>
                      </>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="td">
                    <Badge tone={tono(o.status)}>{label(o.status)}</Badge>
                  </td>
                  <td className="td tabular text-right font-medium">{money(o.amount_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default Orders;
