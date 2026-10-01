import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, traerTodo } from "@/lib/supabase";
import { money, number, date } from "@/lib/format";
import { PageTitle, Stat, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import { SEGMENTOS, SEGMENTO_IDS, esSegmento, type SegmentoId } from "@/lib/segmentos";
import type { CustomerOverview } from "@/lib/types";

/**
 * Clientes, con lo que importa para venderles.
 *
 * Todo sale de `admin_customers()` (migración 0022): compras, gasto, carrito,
 * favoritos y segmentos vienen calculados por la base. Los segmentos son los
 * mismos que usa marketing-send para elegir destinatarios, así que "Crear
 * campaña" desde acá le escribe exactamente a la gente que se está viendo
 * (menos los que se dieron de baja).
 */

export const nombreCliente = (c: { name: string | null; last_name: string | null; email: string }) =>
  [c.name, c.last_name].filter(Boolean).join(" ") || c.email;

const Clientes = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [clientes, setClientes] = useState<CustomerOverview[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // El segmento va en la URL para que se pueda volver desde la ficha de un
  // cliente sin perder el filtro.
  const segParam = params.get("segmento");
  const segmento: SegmentoId | null = esSegmento(segParam) ? segParam : null;

  const elegirSegmento = (s: SegmentoId | null) => {
    const p = new URLSearchParams(params);
    if (s) p.set("segmento", s);
    else p.delete("segmento");
    setParams(p, { replace: true });
  };

  useEffect(() => {
    (async () => {
      try {
        // Por páginas: un rpc también viene cortado en mil filas.
        const filas = await traerTodo<CustomerOverview>((desde, hasta) =>
          supabase.rpc("admin_customers").range(desde, hasta)
        );
        setClientes(filas);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const conteo = useMemo(() => {
    const c = Object.fromEntries(SEGMENTO_IDS.map((s) => [s, 0])) as Record<SegmentoId, number>;
    for (const k of clientes) for (const s of k.segments) c[s]++;
    return c;
  }, [clientes]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return clientes.filter((c) => {
      if (segmento && !c.segments.includes(segmento)) return false;
      if (!q) return true;

      return `${c.name ?? ""} ${c.last_name ?? ""} ${c.email} ${c.phone ?? ""} ${c.province ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [clientes, busqueda, segmento]);

  if (cargando) return <Loading />;

  const compradores = clientes.filter((c) => c.orders_count > 0).length;
  const conCarrito = clientes.filter((c) => c.cart_units > 0);
  const suscriptosFiltrados = filtrados.filter((c) => c.is_subscribed).length;

  return (
    <>
      <PageTitle>Clientes</PageTitle>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Clientes"
          value={number(clientes.length)}
          hint={`${number(clientes.filter((c) => c.is_guest).length)} compraron como invitados`}
        />
        <Stat
          label="Compraron"
          value={number(compradores)}
          hint={`${number(conteo.recurrentes)} más de una vez`}
        />
        <Stat
          label="Carritos abiertos"
          value={number(conCarrito.length)}
          hint={`${money(conCarrito.reduce((t, c) => t + Number(c.cart_amount), 0))} esperando`}
        />
        <Stat
          label="Reciben mails"
          value={number(clientes.filter((c) => c.is_subscribed).length)}
          hint="el resto se dio de baja"
        />
      </div>

      {/* --- Segmentos ---------------------------------------------------- */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => elegirSegmento(null)}
          className={segmento === null ? "btn-primary" : "btn-ghost"}
        >
          Todos <span className="opacity-60">{number(clientes.length)}</span>
        </button>
        {SEGMENTO_IDS.map((s) => (
          <button
            key={s}
            onClick={() => elegirSegmento(segmento === s ? null : s)}
            title={SEGMENTOS[s].descripcion}
            className={segmento === s ? "btn-primary" : "btn-ghost"}
          >
            {SEGMENTOS[s].label} <span className="opacity-60">{number(conteo[s])}</span>
          </button>
        ))}
      </div>

      {segmento && (
        <div className="card mt-4 flex flex-wrap items-center gap-4 p-4">
          <div className="mr-auto">
            <p className="text-sm font-medium">{SEGMENTOS[segmento].label}</p>
            <p className="text-xs text-neutral-500">
              {SEGMENTOS[segmento].descripcion} {number(suscriptosFiltrados)} de{" "}
              {number(filtrados.length)} reciben mails.
            </p>
          </div>
          <button
            className="btn-primary"
            disabled={suscriptosFiltrados === 0}
            onClick={() => navigate(`/email?segmento=${segmento}`)}
          >
            Crear campaña para este segmento
          </button>
        </div>
      )}

      <div className="mb-4 mt-6 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, email, teléfono o provincia…"
          className="input max-w-sm"
        />
        <span className="ml-auto text-sm text-neutral-500">{number(filtrados.length)} clientes</span>
      </div>

      {filtrados.length === 0 ? (
        <Empty>No hay clientes que coincidan.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Cliente</th>
                <th className="th">Provincia</th>
                <th className="th text-right">Compras</th>
                <th className="th text-right">Gastó</th>
                <th className="th">Última compra</th>
                <th className="th text-right">Carrito</th>
                <th className="th">Segmentos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtrados.map((c) => (
                <tr key={c.customer_id} className="transition hover:bg-neutral-50">
                  <td className="td">
                    <Link
                      to={`/clientes/${c.customer_id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {nombreCliente(c)}
                    </Link>
                    <p className="text-xs text-neutral-400">
                      {c.email}
                      {c.is_guest && " · invitado"}
                      {!c.is_subscribed && " · dado de baja"}
                    </p>
                  </td>
                  <td className="td text-neutral-500">{c.province ?? "—"}</td>
                  <td className="td tabular text-right">{number(c.orders_count)}</td>
                  <td className="td tabular text-right font-medium">
                    {c.total_spent > 0 ? money(c.total_spent) : "—"}
                  </td>
                  <td className="td whitespace-nowrap text-neutral-500">{date(c.last_order_at)}</td>
                  <td className="td tabular text-right">
                    {c.cart_units > 0 ? (
                      <>
                        <p>{money(c.cart_amount)}</p>
                        <p className="text-xs text-neutral-400">{date(c.cart_updated_at)}</p>
                      </>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {c.segments.map((s) => (
                        <Badge key={s} tone={SEGMENTOS[s].tone}>
                          {SEGMENTOS[s].label}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default Clientes;
