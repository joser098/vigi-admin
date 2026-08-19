import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number, dateTime } from "@/lib/format";
import { PageTitle, Stat, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import { bruto, comision, estado, medioDePago, neto } from "@/lib/pagos";
import type { PaymentOrder } from "@/lib/types";

const PAGINA = 50;

// `raw` queda afuera del listado a propósito: son decenas de KB por fila. Como
// consecuencia el listado no puede mostrar los últimos 4 de la tarjeta —vive
// adentro de raw—, así que muestra la marca, que sí está en payment_method. Los
// datos completos están en el detalle, incluido si el pago fue de prueba
// (`live_mode`), que también vive en raw.
const CAMPOS =
  "id,gateway,gateway_payment_id,gateway_order_id,customer_id,status,status_detail," +
  "amount,payment_method,transaction_details,date_approved,created_at," +
  "customers(name,last_name,email)";

const Payments = () => {
  const [pagos, setPagos] = useState<PaymentOrder[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroGateway, setFiltroGateway] = useState("");
  const [visibles, setVisibles] = useState(PAGINA);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("payment_orders")
        .select(CAMPOS)
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      setPagos((data ?? []) as unknown as PaymentOrder[]);
      setCargando(false);
    })();
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return pagos.filter((p) => {
      if (filtroGateway && p.gateway !== filtroGateway) return false;
      if (filtroEstado && estado(p).label !== filtroEstado) return false;
      if (!q) return true;

      const c = p.customers;
      const texto = [
        p.gateway_payment_id,
        p.gateway_order_id,
        c?.name,
        c?.last_name,
        c?.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return texto.includes(q);
    });
  }, [pagos, busqueda, filtroEstado, filtroGateway]);

  // Los totales miran lo filtrado, no todo: si estás mirando un mes o una
  // pasarela, el número de arriba tiene que ser el de eso.
  const totales = useMemo(() => {
    const aprobados = filtrados.filter((p) => estado(p).label === "Aprobado");

    return {
      cantidad: aprobados.length,
      cobrado: aprobados.reduce((t, p) => t + (bruto(p) ?? 0), 0),
      neto: aprobados.reduce((t, p) => t + (neto(p) ?? bruto(p) ?? 0), 0),
      comisiones: aprobados.reduce((t, p) => t + (comision(p) ?? 0), 0),
    };
  }, [filtrados]);

  if (cargando) return <Loading />;

  const estadosPosibles = [...new Set(pagos.map((p) => estado(p).label))].sort();

  return (
    <>
      <PageTitle
        action={
          <span className="text-sm text-neutral-500">
            {number(filtrados.length)}
            {filtrados.length !== pagos.length && ` de ${number(pagos.length)}`} pagos
          </span>
        }
      >
        Pagos
      </PageTitle>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Aprobados" value={number(totales.cantidad)} />
        <Stat label="Cobrado" value={money(totales.cobrado)} hint="Lo que pagaron los clientes" />
        <Stat
          label="Neto acreditado"
          value={money(totales.neto)}
          hint="Lo que entra a la cuenta"
        />
        <Stat
          label="Comisiones"
          value={money(totales.comisiones)}
          hint={
            totales.cobrado
              ? `${((totales.comisiones / totales.cobrado) * 100).toFixed(1)}% de lo cobrado`
              : undefined
          }
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nº de pago o cliente…"
          className="input max-w-xs"
        />
        <select
          value={filtroGateway}
          onChange={(e) => setFiltroGateway(e.target.value)}
          className="input max-w-[11rem]"
        >
          <option value="">Todas las pasarelas</option>
          <option value="mercadopago">Mercado Pago</option>
          <option value="nave">Nave</option>
        </select>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="input max-w-[11rem]"
        >
          <option value="">Todos los estados</option>
          {estadosPosibles.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {filtrados.length === 0 ? (
        <Empty>
          {pagos.length === 0 ? "Todavía no hay pagos." : "No hay pagos que coincidan."}
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="th">Fecha</th>
                  <th className="th">Nº de pago</th>
                  <th className="th">Cliente</th>
                  <th className="th">Medio</th>
                  <th className="th">Estado</th>
                  <th className="th text-right">Cobrado</th>
                  <th className="th text-right">Neto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtrados.slice(0, visibles).map((p) => {
                  const e = estado(p);
                  const medio = medioDePago(p);
                  const n = neto(p);

                  return (
                    <tr key={p.id} className="transition hover:bg-neutral-50">
                      <td className="td whitespace-nowrap text-neutral-500">
                        {dateTime(p.date_approved ?? p.created_at)}
                      </td>
                      <td className="td">
                        <Link
                          to={`/pagos/${p.id}`}
                          className="font-medium text-neutral-900 hover:underline"
                        >
                          {p.gateway_payment_id ?? p.gateway_order_id ?? "—"}
                        </Link>
                        <p className="text-xs text-neutral-400">
                          {p.gateway === "mercadopago" ? "Mercado Pago" : "Nave"}
                        </p>
                      </td>
                      <td className="td">
                        {p.customers ? (
                          <>
                            {p.customers.name} {p.customers.last_name}
                            <p className="text-xs text-neutral-400">{p.customers.email}</p>
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="td text-neutral-600">
                        {medio.etiqueta ?? "—"}
                        {medio.marca && (
                          <p className="text-xs text-neutral-400">{medio.marca}</p>
                        )}
                      </td>
                      <td className="td">
                        <Badge tone={e.tone}>{e.label}</Badge>
                      </td>
                      <td className="td tabular text-right font-medium">{money(bruto(p))}</td>
                      <td className="td tabular text-right text-neutral-500">
                        {n != null ? money(n) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {visibles < filtrados.length && (
            <div className="border-t border-neutral-100 p-3 text-center">
              <button onClick={() => setVisibles((v) => v + PAGINA)} className="btn-ghost">
                Ver más ({number(filtrados.length - visibles)} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default Payments;
