import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number, dateTime } from "@/lib/format";
import { Badge, Loading, ErrorBox, Empty } from "@/components/ui";
import {
  bruto,
  comision,
  comisionPct,
  cuotas,
  emailPagador,
  esPrueba,
  estado,
  items,
  medioDePago,
  motivo,
  neto,
  refunds,
  tarjeta,
} from "@/lib/pagos";
import type { Order, PaymentOrder } from "@/lib/types";

const Fila = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-6 border-b border-neutral-100 py-2.5 last:border-b-0">
    <dt className="shrink-0 text-sm text-neutral-500">{label}</dt>
    <dd className="text-right text-sm font-medium text-neutral-900 break-all">
      {children ?? <span className="font-normal text-neutral-400">—</span>}
    </dd>
  </div>
);

const Seccion = ({
  titulo,
  desc,
  children,
  className = "",
}: {
  titulo: string;
  desc?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={`card p-5 ${className}`}>
    <h2 className="text-sm font-medium">{titulo}</h2>
    {desc && <p className="mt-1 text-xs text-neutral-500">{desc}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [pago, setPago] = useState<PaymentOrder | null>(null);
  const [orden, setOrden] = useState<Order | null>(null);
  const [verRaw, setVerRaw] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("payment_orders")
        .select("*,customers(name,last_name,email,phone,dni)")
        .eq("id", id)
        .maybeSingle();

      if (error) setError(error.message);
      const p = (data ?? null) as unknown as PaymentOrder | null;
      setPago(p);

      // La orden es lo que se despacha; el pago es solo la plata. Tenerla
      // enlazada evita el ida y vuelta con la sección de Órdenes.
      const ref = p?.gateway_payment_id;
      if (ref) {
        const { data: o } = await supabase
          .from("orders")
          .select("id,payment_id,status,amount_paid,discount,coupon_code,created_at")
          .eq("payment_id", ref)
          .maybeSingle();
        setOrden((o ?? null) as Order | null);
      }

      setCargando(false);
    })();
  }, [id]);

  if (cargando) return <Loading />;
  if (!pago) return <Empty>No se encontró el pago.</Empty>;

  const e = estado(pago);
  const medio = medioDePago(pago);
  const card = tarjeta(pago);
  const lista = items(pago);
  const devoluciones = refunds(pago);
  const raw = pago.raw ?? {};
  const pct = comisionPct(pago);

  return (
    <>
      <Link
        to="/pagos"
        className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← Pagos
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {pago.gateway_payment_id ?? pago.gateway_order_id}
            </h1>
            <Badge tone={e.tone}>{e.label}</Badge>
            {esPrueba(pago) && <Badge tone="amber">prueba</Badge>}
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {pago.gateway === "mercadopago" ? "Mercado Pago" : "Nave"} ·{" "}
            {dateTime(pago.date_approved ?? pago.created_at)}
          </p>
        </div>

        <div className="text-right">
          <p className="tabular text-3xl font-semibold tracking-tight">{money(bruto(pago))}</p>
          {neto(pago) != null && (
            <p className="text-xs text-neutral-500">{money(neto(pago))} netos</p>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --------------------------------- Plata --------------------------------- */}
        <Seccion
          titulo="Dinero"
          desc="Lo que pagó el cliente no es lo que entra a la cuenta."
        >
          <dl>
            <Fila label="Cobrado">{money(bruto(pago))}</Fila>
            <Fila label="Comisión">
              {comision(pago) != null ? (
                <span className="text-red-600">
                  − {money(comision(pago))}
                  {pct != null && (
                    <span className="ml-1 font-normal text-neutral-400">
                      ({pct.toFixed(2)}%)
                    </span>
                  )}
                </span>
              ) : null}
            </Fila>
            {raw.taxes_amount > 0 && <Fila label="Impuestos">{money(raw.taxes_amount)}</Fila>}
            {raw.shipping_amount > 0 && <Fila label="Envío">{money(raw.shipping_amount)}</Fila>}
            <Fila label="Neto acreditado">
              {neto(pago) != null ? (
                <span className="text-green-700">{money(neto(pago))}</span>
              ) : null}
            </Fila>
            <Fila label="Se acredita">
              {raw.money_release_date ? dateTime(raw.money_release_date) : null}
            </Fila>
            <Fila label="Moneda">{raw.currency_id ?? null}</Fila>
          </dl>
        </Seccion>

        {/* -------------------------------- Medio ---------------------------------- */}
        <Seccion titulo="Medio de pago">
          <dl>
            <Fila label="Tipo">{medio.etiqueta}</Fila>
            <Fila label="Marca">{medio.marca}</Fila>
            <Fila label="Cuotas">
              {cuotas(pago) ? `${cuotas(pago)}${cuotas(pago) === 1 ? " (un pago)" : ""}` : null}
            </Fila>
            {cuotas(pago) && cuotas(pago)! > 1 && (
              <Fila label="Valor de cuota">
                {money(pago.transaction_details?.installment_amount)}
              </Fila>
            )}
            <Fila label="Tarjeta">
              {card ? `${card.primeros6 ?? "······"} ···· ${card.ultimos4}` : null}
            </Fila>
            <Fila label="Vencimiento">{card?.vence}</Fila>
            <Fila label="Titular">{card?.titular}</Fila>
            <Fila label="Cód. autorización">{raw.authorization_code ?? null}</Fila>
          </dl>
        </Seccion>

        {/* -------------------------------- Estado --------------------------------- */}
        <Seccion titulo="Estado">
          <dl>
            <Fila label="Estado">
              <Badge tone={e.tone}>{e.label}</Badge>
            </Fila>
            <Fila label="Motivo">{motivo(pago)}</Fila>
            <Fila label="Creado">{dateTime(pago.created_at)}</Fila>
            <Fila label="Aprobado">
              {pago.date_approved ? dateTime(pago.date_approved) : null}
            </Fila>
            <Fila label="Modo">
              {raw.live_mode === undefined ? null : raw.live_mode ? "Producción" : "Prueba"}
            </Fila>
            <Fila label="Orden interna">
              {orden ? (
                <Link to={`/ordenes/${orden.id}`} className="text-neutral-900 hover:underline">
                  ver orden
                </Link>
              ) : (
                <span className="font-normal text-amber-600">sin orden</span>
              )}
            </Fila>
          </dl>
        </Seccion>

        {/* -------------------------------- Cliente -------------------------------- */}
        <Seccion titulo="Cliente" className="lg:col-span-2">
          <dl>
            <Fila label="Nombre">
              {pago.customers ? `${pago.customers.name} ${pago.customers.last_name}` : null}
            </Fila>
            <Fila label="Email de la cuenta">{pago.customers?.email}</Fila>
            <Fila label="Email en la pasarela">{emailPagador(pago)}</Fila>
            <Fila label="IP">{raw.additional_info?.ip_address ?? null}</Fila>
            <Fila label="Cliente">
              {pago.customer_id ? (
                <span className="font-mono text-xs">{pago.customer_id}</span>
              ) : (
                <span className="font-normal text-amber-600">
                  sin cliente asociado
                </span>
              )}
            </Fila>
          </dl>
        </Seccion>

        {/* ----------------------------- Identificadores --------------------------- */}
        <Seccion titulo="Identificadores" desc="Para buscar en el panel del procesador.">
          <dl>
            <Fila label="Nº de pago">
              <span className="font-mono text-xs">{pago.gateway_payment_id}</span>
            </Fila>
            <Fila label="Nº de orden">
              <span className="font-mono text-xs">{pago.gateway_order_id}</span>
            </Fila>
            <Fila label="Referencia externa">
              <span className="font-mono text-xs">{raw.external_reference ?? null}</span>
            </Fila>
            <Fila label="Preferencia">
              <span className="font-mono text-xs">{raw.order?.id ?? null}</span>
            </Fila>
          </dl>
        </Seccion>

        {/* --------------------------------- Ítems --------------------------------- */}
        {lista.length > 0 && (
          <Seccion titulo="Qué se compró" className="lg:col-span-3">
            <table className="w-full">
              <thead className="border-b border-neutral-200">
                <tr>
                  <th className="th">Producto</th>
                  <th className="th text-right">Cant.</th>
                  <th className="th text-right">Unitario</th>
                  <th className="th text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {lista.map((i, n) => (
                  <tr key={n}>
                    <td className="td">{i.title}</td>
                    <td className="td tabular text-right">{number(i.quantity)}</td>
                    <td className="td tabular text-right">{money(i.unit_price)}</td>
                    <td className="td tabular text-right font-medium">
                      {money(i.unit_price * i.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {orden && Number(orden.discount) > 0 && (
              <p className="mt-3 text-xs text-neutral-500">
                Incluye {money(orden.discount)} de descuento con el cupón{" "}
                <strong className="text-neutral-700">{orden.coupon_code}</strong>. Los
                precios de arriba ya vienen con el descuento repartido.
              </p>
            )}
          </Seccion>
        )}

        {/* ------------------------------ Devoluciones ----------------------------- */}
        {devoluciones.length > 0 && (
          <Seccion titulo="Devoluciones" className="lg:col-span-3">
            <dl>
              {devoluciones.map((r: any, n: number) => (
                <Fila key={n} label={dateTime(r.date_created)}>
                  {money(r.amount)} · {r.status}
                </Fila>
              ))}
            </dl>
          </Seccion>
        )}

        {/* ---------------------------------- Raw ---------------------------------- */}
        <Seccion
          titulo="Respuesta completa del procesador"
          desc="Todo lo que devolvió la pasarela, sin recortar. Es lo que hay que mirar cuando algo no cuadra con lo de arriba."
          className="lg:col-span-3"
        >
          <button onClick={() => setVerRaw((v) => !v)} className="btn-ghost">
            {verRaw ? "Ocultar" : "Ver JSON"}
          </button>

          {verRaw && (
            <pre className="mt-4 max-h-[32rem] overflow-auto rounded-lg bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-100">
              {JSON.stringify(raw, null, 2)}
            </pre>
          )}
        </Seccion>
      </div>
    </>
  );
};

export default PaymentDetail;
