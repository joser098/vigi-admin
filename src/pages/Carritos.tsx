import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { money, number, percent, dateTime } from "@/lib/format";
import { PageTitle, Stat, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import type { CartRecoverySettings, OpenCart, RecoveryEpisode } from "@/lib/types";

/**
 * Carritos abandonados.
 *
 * Quien manda los mails es la Edge Function `cart-recovery`, por cron cada
 * hora. Acá se prende y se apaga, se configura, se ve cuánto cuesta el cupón y
 * se mide qué se recuperó.
 *
 * El porcentaje del cupón no se elige: lo calcula la base por carrito
 * (`cart_recovery_quote`, migración 0021) contra el costo de lo que hay
 * adentro, para que la ganancia neta no baje del mínimo configurado. Lo que
 * esta pantalla muestra como "costo del cupón" sale de esa misma función, así
 * que no puede contradecir lo que se regala.
 */

const PASOS: Record<number, string> = {
  1: "Recordatorio",
  2: "Beneficios",
  3: "Cupón",
};

// Lo que se puede editar, con su etiqueta y una ayuda corta.
const CAMPOS: Array<{
  key: keyof Omit<CartRecoverySettings, "is_active" | "updated_at">;
  label: string;
  ayuda: string;
  sufijo: string;
}> = [
  { key: "step1_hours", label: "Mail 1", ayuda: "Recordatorio", sufijo: "h" },
  { key: "step2_hours", label: "Mail 2", ayuda: "Beneficios", sufijo: "h" },
  { key: "step3_hours", label: "Mail 3", ayuda: "Cupón", sufijo: "h" },
  { key: "max_discount_pct", label: "Descuento máximo", ayuda: "Nunca más que esto", sufijo: "%" },
  { key: "min_discount_pct", label: "Descuento mínimo", ayuda: "Menos que esto, no hay cupón", sufijo: "%" },
  { key: "min_net_margin_pct", label: "Ganancia mínima", ayuda: "Neta sobre costo, después del cupón", sufijo: "%" },
  { key: "gateway_fee_pct", label: "Comisión pasarela", ayuda: "Sobre lo que paga el cliente", sufijo: "%" },
  { key: "coupon_valid_hours", label: "Validez del cupón", ayuda: "Desde que sale el mail", sufijo: "h" },
  { key: "coupon_cooldown_days", label: "Un cupón cada", ayuda: "Por cliente", sufijo: "días" },
  { key: "daily_limit", label: "Tope diario", ayuda: "Mails de recupero por día", sufijo: "mails" },
];

const nombreDe = (x: { name: string | null; last_name: string | null; email: string }) =>
  [x.name, x.last_name].filter(Boolean).join(" ") || x.email;

const hace = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return "hace menos de 1 h";
  if (h < 48) return `hace ${Math.floor(h)} h`;
  return `hace ${Math.floor(h / 24)} días`;
};

const Carritos = () => {
  const { email } = useAuth();
  const [ajustes, setAjustes] = useState<CartRecoverySettings | null>(null);
  const [borrador, setBorrador] = useState<CartRecoverySettings | null>(null);
  const [carritos, setCarritos] = useState<OpenCart[]>([]);
  const [episodios, setEpisodios] = useState<RecoveryEpisode[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const [pasoPrevia, setPasoPrevia] = useState(1);
  const [previa, setPrevia] = useState<{ subject: string; html: string } | null>(null);
  const [emailPrueba, setEmailPrueba] = useState("");

  const cargar = async () => {
    const [s, c, e] = await Promise.all([
      supabase.from("cart_recovery_settings").select("*").maybeSingle(),
      supabase.rpc("admin_cart_recovery_open_carts"),
      supabase
        .from("admin_cart_recovery_episodes")
        .select("*")
        .order("last_activity_at", { ascending: false })
        .limit(200),
    ]);

    const err = s.error ?? c.error ?? e.error;
    setError(err ? err.message : "");

    setAjustes((s.data ?? null) as CartRecoverySettings | null);
    setBorrador((s.data ?? null) as CartRecoverySettings | null);
    setCarritos((c.data ?? []) as OpenCart[]);
    setEpisodios((e.data ?? []) as RecoveryEpisode[]);
    setCargando(false);
  };

  useEffect(() => {
    cargar();
  }, []);

  useEffect(() => {
    if (email && !emailPrueba) setEmailPrueba(email);
  }, [email]);

  // La vista previa se pide a la function, que arma el mismo HTML que manda.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("cart-recovery", {
        body: { action: "preview", step: pasoPrevia },
      });
      if (error || data?.error) {
        setPrevia(null);
        return;
      }
      setPrevia({ subject: data.subject, html: data.html });
    })();
  }, [pasoPrevia]);

  // --- Cuánto cuesta el cupón ---------------------------------------------
  // Sobre los carritos abiertos hoy, si todos compraran con su cupón. Es el
  // peor caso: en la práctica la mayoría no vuelve.
  const simulacion = useMemo(() => {
    const f = Number(ajustes?.gateway_fee_pct ?? 7) / 100;
    const conCupon = carritos.filter((k) => k.discount_pct != null && k.cost != null);

    const ventas = conCupon.reduce((t, k) => t + Number(k.amount), 0);
    const costo = conCupon.reduce((t, k) => t + Number(k.cost), 0);
    const descuento = conCupon.reduce((t, k) => t + Number(k.discount_amount), 0);

    const gananciaAntes = ventas * (1 - f) - costo;
    const gananciaDespues = (ventas - descuento) * (1 - f) - costo;

    return {
      conCupon: conCupon.length,
      sinCosto: carritos.filter((k) => k.cost == null).length,
      sinMargen: carritos.filter((k) => k.cost != null && k.discount_pct == null).length,
      ventas,
      descuento,
      pctPromedio: ventas > 0 ? Math.round((descuento / ventas) * 1000) / 10 : 0,
      gananciaAntes,
      gananciaDespues,
      margenAntes: costo > 0 ? Math.round((gananciaAntes / costo) * 1000) / 10 : null,
      margenDespues: costo > 0 ? Math.round((gananciaDespues / costo) * 1000) / 10 : null,
    };
  }, [carritos, ajustes]);

  // --- Resultados -----------------------------------------------------------
  const resultados = useMemo(() => {
    const enviados = episodios.filter((e) => e.first_sent_at);
    const recuperados = enviados.filter((e) => e.order_id);
    const conCupon = recuperados.filter((e) => e.used_coupon);

    return {
      episodios: enviados.length,
      recuperados: recuperados.length,
      tasa: enviados.length ? Math.round((recuperados.length / enviados.length) * 1000) / 10 : 0,
      facturado: recuperados.reduce((t, e) => t + Number(e.order_amount ?? 0), 0),
      cuponesUsados: conCupon.length,
      descuentoEntregado: conCupon.reduce((t, e) => t + Number(e.order_discount ?? 0), 0),
      cuponesEnviados: episodios.filter((e) => e.coupon_code).length,
    };
  }, [episodios]);

  // --- Acciones -------------------------------------------------------------
  const guardar = async (cambios: Partial<CartRecoverySettings>) => {
    setOcupado(true);
    setAviso("");

    const { error } = await supabase
      .from("cart_recovery_settings")
      .update(cambios)
      .eq("id", true);

    setOcupado(false);

    if (error) {
      // Las reglas (pasos en orden, mínimo ≤ máximo) las valida la base.
      setError(error.message);
      return;
    }

    setError("");
    setAviso("Guardado. Los cupones estimados se recalcularon con la configuración nueva.");
    await cargar();
  };

  const guardarAjustes = () => {
    if (!borrador) return;
    const cambios = Object.fromEntries(CAMPOS.map((c) => [c.key, Number(borrador[c.key])]));
    guardar(cambios as Partial<CartRecoverySettings>);
  };

  const llamar = async (body: Record<string, unknown>) => {
    setOcupado(true);
    setAviso("");

    const { data, error } = await supabase.functions.invoke("cart-recovery", { body });
    setOcupado(false);

    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? "Falló la function");
      return null;
    }

    setError("");
    return data;
  };

  const correrAhora = async () => {
    const r = await llamar({ action: "run" });
    if (!r) return;
    setAviso(r.message ?? "Listo.");
    await cargar();
  };

  const mandarPrueba = async () => {
    const r = await llamar({ action: "test", step: pasoPrevia, email: emailPrueba.trim() });
    if (r) setAviso(`Prueba del mail ${pasoPrevia} enviada a ${emailPrueba.trim()}.`);
  };

  if (cargando) return <Loading />;

  const activo = Boolean(ajustes?.is_active);
  const pendientes = carritos.filter((k) => k.due).length;
  const enCarritos = carritos.reduce((t, k) => t + Number(k.amount), 0);

  return (
    <>
      <PageTitle
        action={
          ajustes && (
            <div className="flex items-center gap-3">
              <button className="btn-ghost" disabled={ocupado || !activo} onClick={correrAhora}>
                Correr ahora
              </button>
              <button
                className={activo ? "btn-ghost" : "btn-primary"}
                disabled={ocupado}
                onClick={() => guardar({ is_active: !activo })}
              >
                {activo ? "Apagar" : "Prender recupero"}
              </button>
            </div>
          )
        }
      >
        Carritos abandonados{" "}
        <Badge tone={activo ? "green" : "neutral"}>{activo ? "activo" : "apagado"}</Badge>
      </PageTitle>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
      {aviso && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-700">{aviso}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Carritos abiertos"
          value={number(carritos.length)}
          hint={`${money(enCarritos)} esperando · ${number(pendientes)} con mail pendiente`}
        />
        <Stat
          label="Recuperados"
          value={number(resultados.recuperados)}
          hint={`${percent(resultados.tasa)} de ${number(resultados.episodios)} carritos contactados`}
        />
        <Stat label="Facturado recuperado" value={money(resultados.facturado)} hint="compras dentro de los 10 días" />
        <Stat
          label="Descuento entregado"
          value={money(resultados.descuentoEntregado)}
          hint={`${number(resultados.cuponesUsados)} de ${number(resultados.cuponesEnviados)} cupones usados`}
        />
      </div>

      {/* --- Cuánto nos cuesta ------------------------------------------- */}
      <section className="card mt-6 p-5">
        <h2 className="text-sm font-medium">Cuánto nos cuesta el cupón</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Peor caso: si todos los carritos abiertos hoy compraran con su cupón. Cada cupón se calcula
          contra el costo de su carrito para que la ganancia neta no baje de{" "}
          <b>{percent(ajustes?.min_net_margin_pct)}</b>, con tope de{" "}
          <b>{percent(ajustes?.max_discount_pct)}</b>.
        </p>

        {simulacion.conCupon === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">Ningún carrito abierto recibiría cupón hoy.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="label">Ventas en juego</p>
              <p className="tabular text-lg font-semibold">{money(simulacion.ventas)}</p>
              <p className="text-xs text-neutral-400">{number(simulacion.conCupon)} carritos con cupón</p>
            </div>
            <div>
              <p className="label">Descuento total</p>
              <p className="tabular text-lg font-semibold">{money(simulacion.descuento)}</p>
              <p className="text-xs text-neutral-400">{percent(simulacion.pctPromedio)} promedio</p>
            </div>
            <div>
              <p className="label">Ganancia neta</p>
              <p className="tabular text-lg font-semibold">
                {money(simulacion.gananciaAntes)} → {money(simulacion.gananciaDespues)}
              </p>
              <p className="text-xs text-neutral-400">después de comisión</p>
            </div>
            <div>
              <p className="label">Margen sobre costo</p>
              <p className="tabular text-lg font-semibold">
                {percent(simulacion.margenAntes)} → {percent(simulacion.margenDespues)}
              </p>
              <p className="text-xs text-neutral-400">nunca por debajo del mínimo</p>
            </div>
          </div>
        )}

        {(simulacion.sinCosto > 0 || simulacion.sinMargen > 0) && (
          <p className="mt-4 text-xs text-neutral-500">
            Sin cupón: {number(simulacion.sinMargen)} por margen insuficiente
            {simulacion.sinCosto > 0 && (
              <>
                {" "}
                y {number(simulacion.sinCosto)} con productos sin costo cargado (sin costo no se puede
                saber cuánto se regala)
              </>
            )}
            . A esos el tercer mail no les llega.
          </p>
        )}
      </section>

      {/* --- Carritos abiertos ------------------------------------------- */}
      <h2 className="mb-3 mt-8 text-sm font-medium">Carritos abiertos</h2>
      {carritos.length === 0 ? (
        <Empty>No hay carritos abandonados en este momento.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Cliente</th>
                <th className="th">Productos</th>
                <th className="th text-right">Total</th>
                <th className="th">Última actividad</th>
                <th className="th">Secuencia</th>
                <th className="th">Cupón estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {carritos.map((k) => (
                <tr key={k.cart_id}>
                  <td className="td">
                    <p className="font-medium text-neutral-900">{nombreDe(k)}</p>
                    <p className="text-xs text-neutral-400">{k.email}</p>
                  </td>
                  <td className="td max-w-xs">
                    <p className="truncate">
                      {k.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")}
                    </p>
                  </td>
                  <td className="td tabular text-right font-medium">{money(k.amount)}</td>
                  <td className="td whitespace-nowrap text-neutral-500">{hace(k.cart_updated_at)}</td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {k.unsubscribed ? (
                        <Badge tone="neutral">dado de baja</Badge>
                      ) : k.next_step == null ? (
                        <Badge tone="neutral">terminada</Badge>
                      ) : (
                        <Badge tone={k.due ? "amber" : "violet"}>
                          {k.due ? "sale ahora" : "próximo"}: {PASOS[k.next_step]}
                        </Badge>
                      )}
                      {k.last_step != null && (
                        <span className="text-xs text-neutral-400">
                          {k.last_step}/3 enviados
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td whitespace-nowrap">
                    {k.coupon_blocked ? (
                      <span className="text-xs text-neutral-400">ya tuvo cupón hace poco</span>
                    ) : k.discount_pct == null ? (
                      <span className="text-xs text-neutral-400">
                        {k.cost == null ? "falta el costo" : "sin margen"}
                      </span>
                    ) : (
                      <>
                        <p className="tabular font-medium">
                          {percent(k.discount_pct)} · {money(k.discount_amount)}
                        </p>
                        <p className="text-xs text-neutral-400">
                          margen {percent(k.margin_before_pct)} → {percent(k.margin_after_pct)}
                        </p>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Historial ---------------------------------------------------- */}
      <h2 className="mb-3 mt-8 text-sm font-medium">Historial</h2>
      {episodios.length === 0 ? (
        <Empty>Todavía no salió ningún mail de recupero.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Cliente</th>
                <th className="th text-right">Carrito</th>
                <th className="th">Mails</th>
                <th className="th">Cupón</th>
                <th className="th">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {episodios.map((e) => (
                <tr key={`${e.cart_id}-${e.cart_updated_at}`}>
                  <td className="td">
                    <p className="font-medium text-neutral-900">{nombreDe(e)}</p>
                    <p className="text-xs text-neutral-400">{dateTime(e.first_sent_at ?? e.last_activity_at)}</p>
                  </td>
                  <td className="td tabular text-right">{money(e.cart_amount)}</td>
                  <td className="td text-neutral-500">
                    {e.last_step ? `${e.last_step}/3` : "—"}
                    {e.had_failures && (
                      <span className="ml-2">
                        <Badge tone="red">falló alguno</Badge>
                      </span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap">
                    {e.coupon_code ? (
                      <>
                        <p className="font-mono text-xs">{e.coupon_code}</p>
                        <p className="text-xs text-neutral-400">
                          {percent(e.discount_pct)} · hasta {money(e.discount_amount)}
                        </p>
                      </>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="td">
                    {e.order_id ? (
                      <div className="flex items-center gap-2">
                        <Badge tone="green">compró {money(e.order_amount)}</Badge>
                        {e.used_coupon && <Badge tone="violet">con cupón</Badge>}
                      </div>
                    ) : (
                      <span className="text-neutral-400">sin compra</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {/* --- Configuración ---------------------------------------------- */}
        <section className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-medium">Configuración</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Las horas se cuentan desde la última vez que el cliente tocó el carrito.
          </p>

          {borrador && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              {CAMPOS.map((c) => (
                <label key={c.key} className="block">
                  <span className="label">{c.label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="input"
                      value={String(borrador[c.key])}
                      onChange={(e) => setBorrador({ ...borrador, [c.key]: e.target.value })}
                    />
                    <span className="text-xs text-neutral-500">{c.sufijo}</span>
                  </div>
                  <span className="mt-1 block text-[11px] text-neutral-400">{c.ayuda}</span>
                </label>
              ))}
            </div>
          )}

          <button className="btn-primary mt-5" disabled={ocupado} onClick={guardarAjustes}>
            Guardar
          </button>
        </section>

        {/* --- Vista previa ----------------------------------------------- */}
        <section className="card p-5 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-medium">Vista previa</h2>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                className={pasoPrevia === n ? "btn-primary" : "btn-ghost"}
                onClick={() => setPasoPrevia(n)}
              >
                {n}. {PASOS[n]}
              </button>
            ))}
          </div>

          {previa ? (
            <>
              <p className="mt-4 text-xs text-neutral-500">
                Asunto: <b className="text-neutral-800">{previa.subject}</b>
              </p>
              <iframe
                title="Vista previa del mail"
                srcDoc={previa.html}
                sandbox=""
                className="mt-3 h-[560px] w-full rounded-lg border border-neutral-200"
              />
            </>
          ) : (
            <p className="mt-4 text-sm text-neutral-400">Cargando vista previa…</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              className="input max-w-xs"
              value={emailPrueba}
              onChange={(e) => setEmailPrueba(e.target.value)}
              placeholder="tu@email.com"
            />
            <button className="btn-ghost" disabled={ocupado || !emailPrueba.trim()} onClick={mandarPrueba}>
              Mandarme una prueba
            </button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            Usa el carrito abierto más caro, o uno de ejemplo. El cupón de la prueba no existe.
          </p>
        </section>
      </div>
    </>
  );
};

export default Carritos;
