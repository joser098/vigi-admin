import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { dateTime } from "@/lib/format";
import { Badge } from "@/components/ui";
import type { Order } from "@/lib/types";

export type Aviso = {
  id: string;
  status: string;
  email: string;
  sent_at: string;
  provider_message_id: string | null;
  error: string | null;
  sent_by: string | null;
};

const EMPRESAS = ["Andreani", "Correo Argentino", "OCA", "Moto / mensajería"];

/**
 * Seguimiento del envío y mails que se le mandaron al cliente (migraciones 0024 y 0025
 * de vigi-api).
 *
 * El mail sale al confirmar un cambio de estado (CambioEstadoModal). Acá se
 * carga el seguimiento, que va en el mail de "En camino", y se ve qué salió.
 */
export const PedidoAvisos = ({
  orden,
  avisos,
  etiquetas,
  onGuardado,
  onReenviar,
}: {
  orden: Order;
  avisos: Aviso[];
  etiquetas: Record<string, string>;
  onGuardado: () => Promise<void>;
  onReenviar: (status: string) => void;
}) => {
  const [form, setForm] = useState({
    carrier: orden.carrier ?? "",
    tracking_number: orden.tracking_number ?? "",
    tracking_url: orden.tracking_url ?? "",
  });
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState("");

  const sucio =
    form.carrier !== (orden.carrier ?? "") ||
    form.tracking_number !== (orden.tracking_number ?? "") ||
    form.tracking_url !== (orden.tracking_url ?? "");

  const guardar = async () => {
    const url = form.tracking_url.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError("El link tiene que empezar con http:// o https://");
      return;
    }
    setGuardando(true);
    setError("");
    const { error: e } = await supabase
      .from("orders")
      .update({
        carrier: form.carrier.trim() || null,
        tracking_number: form.tracking_number.trim() || null,
        tracking_url: url || null,
      })
      .eq("id", orden.id);
    if (e) setError(e.message);
    else {
      await onGuardado();
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    }
    setGuardando(false);
  };

  const sinSeguimiento = orden.status === "enviado" && !orden.tracking_number;

  return (
    <section className="card p-5">
      <h2 className="text-sm font-medium">Seguimiento y avisos al cliente</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Cargá el seguimiento <b>antes</b> de pasar la orden a <b>En camino</b>: va en ese mail.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Empresa</label>
          <input
            list="empresas-envio"
            value={form.carrier}
            onChange={(e) => setForm({ ...form, carrier: e.target.value })}
            placeholder="Andreani"
            className="input"
          />
          <datalist id="empresas-envio">
            {EMPRESAS.map((e) => <option key={e} value={e} />)}
          </datalist>
        </div>
        <div>
          <label className="label">Número de seguimiento</label>
          <input
            value={form.tracking_number}
            onChange={(e) => setForm({ ...form, tracking_number: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label className="label">Link de seguimiento</label>
          <input
            value={form.tracking_url}
            onChange={(e) => setForm({ ...form, tracking_url: e.target.value })}
            placeholder="opcional"
            className="input"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={guardar} disabled={guardando || !sucio} className="btn-primary disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar seguimiento"}
        </button>
        {guardado && <span className="text-xs text-green-600">Guardado</span>}
        {sinSeguimiento && !sucio && (
          <span className="text-xs text-amber-600">Está En camino sin número de seguimiento.</span>
        )}
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <p className="label">Mails de este pedido</p>
        {avisos.length ? (
          <ul className="space-y-2">
            {avisos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {etiquetas[a.status] ?? a.status}
                  <span className="ml-2 text-xs text-neutral-400">{dateTime(a.sent_at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {a.error ? (
                    <>
                      <Badge tone="red">falló: {a.error}</Badge>
                      {a.status === orden.status && (
                        <button onClick={() => onReenviar(a.status)} className="text-xs underline">
                          Reenviar
                        </button>
                      )}
                    </>
                  ) : (
                    <Badge tone="green">enviado a {a.email}</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-400">Todavía no se mandó ninguno.</p>
        )}
      </div>
    </section>
  );
};
