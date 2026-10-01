import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dateTime } from "@/lib/format";
import type { Order } from "@/lib/types";

// Los estados que tienen mail (ver order-notifications en vigi-api).
export const ESTADOS_CON_MAIL = ["enviado", "entregado", "cancelado", "reembolsado"];

/** El mensaje de error real de la function, no el genérico de supabase-js. */
const mensajeDe = async (error: unknown) => {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // sin cuerpo JSON: cae al mensaje de abajo
    }
  }
  return error instanceof Error ? error.message : String(error);
};

export type ResultadoCambio = { mail: { ok: boolean; email?: string; error?: string } | null };

/**
 * Confirmación del cambio de estado de una orden.
 *
 * Cambia el estado y manda el mail en una sola llamada a la Edge Function
 * `order-notifications`: lo que se confirma acá es lo que pasa. La casilla
 * del mail viene marcada, salvo que ese mail ya haya salido antes.
 */
export const CambioEstadoModal = ({
  orden,
  destino,
  etiquetas,
  emailCliente,
  yaEnviado,
  onCerrar,
  onHecho,
}: {
  orden: Order;
  destino: string;
  etiquetas: Record<string, string>;
  emailCliente: string | null;
  /** Fecha del último mail de este estado que salió bien, si hay. */
  yaEnviado: string | null;
  onCerrar: () => void;
  onHecho: (r: ResultadoCambio) => void;
}) => {
  const tieneMail = ESTADOS_CON_MAIL.includes(destino);
  const reenvio = destino === orden.status;
  const [notificar, setNotificar] = useState(tieneMail && (!yaEnviado || reenvio));
  const [vista, setVista] = useState<{ subject: string; html: string } | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // Escape cierra, como cualquier modal.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !guardando && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [guardando, onCerrar]);

  const verMail = async () => {
    if (vista) return setVista(null);
    setCargandoVista(true);
    setError("");
    const { data, error: e } = await supabase.functions.invoke("order-notifications", {
      body: { action: "preview", status: destino, order_id: orden.id },
    });
    if (e) setError(await mensajeDe(e));
    else setVista(data);
    setCargandoVista(false);
  };

  const confirmar = async () => {
    setGuardando(true);
    setError("");
    const { data, error: e } = await supabase.functions.invoke("order-notifications", {
      body: { action: "change_status", order_id: orden.id, status: destino, notify: tieneMail && notificar },
    });
    setGuardando(false);
    if (e) return setError(await mensajeDe(e));
    onHecho(data as ResultadoCambio);
  };

  const sinSeguimiento = destino === "enviado" && !orden.tracking_number;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !guardando && onCerrar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cambio-estado-titulo"
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cambio-estado-titulo" className="text-base font-semibold">
          {reenvio
            ? `¿Reenviar el mail de "${etiquetas[destino] ?? destino}"?`
            : `¿Pasar la orden a "${etiquetas[destino] ?? destino}"?`}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Orden {orden.payment_id}
          {!reenvio && <> · hoy está en <b>{etiquetas[orden.status] ?? orden.status}</b></>}
        </p>

        {tieneMail ? (
          <div className="mt-5 space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={notificar}
                onChange={(e) => setNotificar(e.target.checked)}
                disabled={reenvio}
                className="mt-0.5 size-4 rounded border-neutral-300 text-primary focus:ring-primary/20"
              />
              <span>
                Mandarle un mail al cliente
                {emailCliente && <span className="block text-xs text-neutral-500">{emailCliente}</span>}
              </span>
            </label>

            {yaEnviado && !reenvio && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Este mail ya se le mandó el {dateTime(yaEnviado)}. Marcalo solo si querés mandarlo de nuevo.
              </p>
            )}
            {notificar && sinSeguimiento && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No hay número de seguimiento cargado: el mail sale sin él. Si lo tenés, cancelá, cargalo en
                "Seguimiento" y volvé a cambiar el estado.
              </p>
            )}

            <button type="button" onClick={verMail} disabled={cargandoVista} className="text-xs underline">
              {cargandoVista ? "Cargando…" : vista ? "Ocultar el mail" : "Ver el mail"}
            </button>
            {vista && (
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <p className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
                  <span className="text-neutral-400">Asunto:</span> {vista.subject}
                </p>
                <iframe title="Vista previa del mail" srcDoc={vista.html} className="h-[420px] w-full bg-white" />
              </div>
            )}
          </div>
        ) : (
          <p className="mt-5 text-sm text-neutral-600">Este estado no le manda mail al cliente.</p>
        )}

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={guardando} className="btn-primary">
            {guardando
              ? "Guardando…"
              : reenvio
                ? "Reenviar mail"
                : tieneMail && notificar
                  ? "Cambiar y mandar mail"
                  : "Cambiar estado"}
          </button>
        </div>
      </div>
    </div>
  );
};
