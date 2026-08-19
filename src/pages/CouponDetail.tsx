import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number, dateTime } from "@/lib/format";
import { Badge, Loading, ErrorBox, Empty } from "@/components/ui";
import { descuentoDe, estadoDe } from "./Coupons";
import type { Coupon, CouponRedemption } from "@/lib/types";

// Lo que el panel puede escribir. Coincide con los GRANT de la 0011:
// `redemptions` no está, porque es un contador que mantiene el trigger.
type Editable = {
  code: string;
  description: string;
  kind: "percentage" | "fixed";
  value: string;
  max_discount: string;
  min_purchase: string;
  max_redemptions: string;
  max_per_customer: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

const VACIO: Editable = {
  code: "",
  description: "",
  kind: "percentage",
  value: "10",
  max_discount: "",
  min_purchase: "",
  max_redemptions: "",
  max_per_customer: "1",
  starts_at: "",
  ends_at: "",
  is_active: true,
};

// <input type="datetime-local"> habla en hora local sin zona; la base guarda
// timestamptz. Estas dos hacen la traducción en los dos sentidos.
const aInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const aISO = (valor: string) =>
  valor ? new Date(valor).toISOString() : null;

const numeroONull = (valor: string) => {
  const n = Number(valor);
  return valor.trim() === "" || !Number.isFinite(n) ? null : n;
};

const Campo = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div>
    <label className="label">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
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

const CouponDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const esNuevo = id === "nuevo";

  const [cupon, setCupon] = useState<Coupon | null>(null);
  const [canjes, setCanjes] = useState<CouponRedemption[]>([]);
  const [form, setForm] = useState<Editable>(VACIO);
  const [cargando, setCargando] = useState(!esNuevo);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [sucio, setSucio] = useState(esNuevo);
  const [error, setError] = useState("");

  const cargar = async () => {
    const [c, r] = await Promise.all([
      supabase.from("coupons").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("coupon_redemptions")
        .select("*,customers(name,last_name,email)")
        .eq("coupon_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (c.error) setError(c.error.message);

    if (c.data) {
      const cp = c.data as Coupon;
      setCupon(cp);
      setForm({
        code: cp.code,
        description: cp.description ?? "",
        kind: cp.kind,
        value: String(cp.value),
        max_discount: cp.max_discount != null ? String(cp.max_discount) : "",
        min_purchase: Number(cp.min_purchase) ? String(cp.min_purchase) : "",
        max_redemptions:
          cp.max_redemptions != null ? String(cp.max_redemptions) : "",
        max_per_customer:
          cp.max_per_customer != null ? String(cp.max_per_customer) : "",
        starts_at: aInput(cp.starts_at),
        ends_at: aInput(cp.ends_at),
        is_active: cp.is_active,
      });
    }

    setCanjes((r.data ?? []) as unknown as CouponRedemption[]);
    setSucio(false);
    setCargando(false);
  };

  useEffect(() => {
    if (!esNuevo) cargar();
  }, [id]);

  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setGuardado(false);
    setSucio(true);
  };

  const guardar = async () => {
    setError("");

    const value = Number(form.value);
    const code = form.code.trim().toUpperCase();

    if (!code) return setError("El código no puede estar vacío.");
    if (!Number.isFinite(value) || value <= 0)
      return setError("El descuento tiene que ser mayor que cero.");
    if (form.kind === "percentage" && (value < 1 || value > 100))
      return setError("Un porcentaje va entre 1 y 100.");

    const payload = {
      code,
      description: form.description.trim() || null,
      kind: form.kind,
      value,
      // El tope en pesos solo existe para porcentajes: la base tiene un check
      // que rechaza la combinación, así que se limpia acá.
      max_discount:
        form.kind === "percentage" ? numeroONull(form.max_discount) : null,
      min_purchase: numeroONull(form.min_purchase) ?? 0,
      max_redemptions: numeroONull(form.max_redemptions),
      max_per_customer: numeroONull(form.max_per_customer),
      starts_at: aISO(form.starts_at),
      ends_at: aISO(form.ends_at),
      is_active: form.is_active,
    };

    setGuardando(true);

    try {
      if (esNuevo) {
        const { data, error } = await supabase
          .from("coupons")
          .insert(payload)
          .select("id")
          .single();

        if (error) throw new Error(error.message);
        navigate(`/cupones/${data.id}`, { replace: true });
      } else {
        const { error } = await supabase
          .from("coupons")
          .update(payload)
          .eq("id", id);

        if (error) throw new Error(error.message);
        setGuardado(true);
        await cargar();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async () => {
    setError("");
    setGuardando(true);

    const { error } = await supabase.from("coupons").delete().eq("id", id);

    setGuardando(false);
    if (error) return setError(error.message);
    navigate("/cupones");
  };

  if (cargando) return <Loading />;
  if (!esNuevo && !cupon) return <Empty>No se encontró el cupón.</Empty>;

  const estado = cupon ? estadoDe(cupon) : null;
  const usado = (cupon?.redemptions ?? 0) > 0;

  return (
    <>
      <Link
        to="/cupones"
        className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← Cupones
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {esNuevo ? "Nuevo cupón" : cupon!.code}
            </h1>
            {estado && <Badge tone={estado.tone}>{estado.label}</Badge>}
          </div>
          {cupon && (
            <p className="mt-1 text-sm text-neutral-500">
              {descuentoDe(cupon)} · {number(cupon.redemptions)} usos
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {guardado && <span className="text-xs text-green-600">Guardado</span>}
          {sucio && !guardado && (
            <span className="text-xs text-amber-600">Sin guardar</span>
          )}
          <button
            onClick={guardar}
            disabled={guardando || (!sucio && !esNuevo)}
            className="btn-primary"
          >
            {guardando ? "Guardando…" : esNuevo ? "Crear cupón" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Seccion
          titulo="Descuento"
          desc="El código no distingue mayúsculas: el cliente lo puede escribir como quiera."
          className="lg:col-span-2"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Código">
              <input
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                placeholder="VERANO25"
                className="input uppercase"
              />
            </Campo>

            <Campo label="Descripción" hint="Para uso interno del panel.">
              <input
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Campaña de verano"
                className="input"
              />
            </Campo>

            <Campo label="Tipo">
              <select
                value={form.kind}
                onChange={(e) =>
                  set("kind", e.target.value as Editable["kind"])
                }
                className="input"
              >
                <option value="percentage">Porcentaje</option>
                <option value="fixed">Monto fijo</option>
              </select>
            </Campo>

            <Campo
              label={form.kind === "percentage" ? "Porcentaje (1–100)" : "Monto en pesos"}
            >
              <input
                type="number"
                min={form.kind === "percentage" ? 1 : 0}
                max={form.kind === "percentage" ? 100 : undefined}
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                className="input tabular"
              />
            </Campo>

            {form.kind === "percentage" && (
              <Campo
                label="Tope del descuento"
                hint="En pesos. Vacío = sin tope. Es lo que evita que un 20% sobre un kit caro regale una fortuna."
              >
                <input
                  type="number"
                  min={0}
                  value={form.max_discount}
                  onChange={(e) => set("max_discount", e.target.value)}
                  placeholder="sin tope"
                  className="input tabular"
                />
              </Campo>
            )}

            <Campo
              label="Compra mínima"
              hint="Subtotal de productos, sin envío. Vacío = sin mínimo."
            >
              <input
                type="number"
                min={0}
                value={form.min_purchase}
                onChange={(e) => set("min_purchase", e.target.value)}
                placeholder="sin mínimo"
                className="input tabular"
              />
            </Campo>
          </div>
        </Seccion>

        <Seccion titulo="Estado" desc="Apagarlo lo saca de circulación en el acto.">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            Cupón activo
          </label>

          {cupon && (
            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Usos</dt>
                <dd className="tabular font-medium">
                  {number(cupon.redemptions)}
                  {cupon.max_redemptions != null &&
                    ` / ${number(cupon.max_redemptions)}`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Descontado</dt>
                <dd className="tabular font-medium">
                  {money(canjes.reduce((t, c) => t + Number(c.amount), 0))}
                </dd>
              </div>
            </dl>
          )}

          {!esNuevo && (
            <div className="mt-6 border-t border-neutral-200 pt-4">
              {/* Borrar un cupón ya usado se llevaría puesto el historial de
                  canjes, que es lo que explica descuentos en órdenes viejas.
                  Apagarlo hace el mismo trabajo sin perder nada. */}
              {usado ? (
                <p className="text-xs text-neutral-400">
                  Este cupón ya se usó, así que no se puede borrar. Apagalo para
                  sacarlo de circulación.
                </p>
              ) : (
                <button
                  onClick={borrar}
                  disabled={guardando}
                  className="btn-ghost w-full text-red-600 hover:bg-red-50"
                >
                  Borrar cupón
                </button>
              )}
            </div>
          )}
        </Seccion>

        <Seccion
          titulo="Límites"
          desc="Vacío en cualquiera de los dos significa sin límite."
          className="lg:col-span-2"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Usos totales">
              <input
                type="number"
                min={1}
                value={form.max_redemptions}
                onChange={(e) => set("max_redemptions", e.target.value)}
                placeholder="ilimitado"
                className="input tabular"
              />
            </Campo>

            <Campo label="Usos por cliente">
              <input
                type="number"
                min={1}
                value={form.max_per_customer}
                onChange={(e) => set("max_per_customer", e.target.value)}
                placeholder="ilimitado"
                className="input tabular"
              />
            </Campo>

            <Campo label="Desde" hint="Vacío = vigente ya.">
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
                className="input"
              />
            </Campo>

            <Campo label="Hasta" hint="Vacío = sin vencimiento.">
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
                className="input"
              />
            </Campo>
          </div>
        </Seccion>

        {!esNuevo && (
          <Seccion titulo="Canjes" className="lg:col-span-3">
            {canjes.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Todavía no lo usó nadie.
              </p>
            ) : (
              <table className="w-full">
                <thead className="border-b border-neutral-200">
                  <tr>
                    <th className="th">Fecha</th>
                    <th className="th">Cliente</th>
                    <th className="th text-right">Descuento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {canjes.map((c) => (
                    <tr key={c.id}>
                      <td className="td whitespace-nowrap text-neutral-500">
                        {dateTime(c.created_at)}
                      </td>
                      <td className="td">
                        {c.customers ? (
                          <>
                            {c.customers.name} {c.customers.last_name}
                            <p className="text-xs text-neutral-400">
                              {c.customers.email}
                            </p>
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="td tabular text-right font-medium">
                        {money(c.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Seccion>
        )}
      </div>
    </>
  );
};

export default CouponDetail;
