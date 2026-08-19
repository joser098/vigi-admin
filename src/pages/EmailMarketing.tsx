import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { number, dateTime } from "@/lib/format";
import { PageTitle, Stat, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import type { MarketingCampaign, MarketingContact } from "@/lib/types";

/**
 * Email marketing.
 *
 * Quien manda es la Edge Function `marketing-send`, nunca el navegador: la API
 * key de Resend no puede estar en el bundle. Esta pantalla arma la campaña,
 * muestra la preview y aprieta el botón.
 *
 * Dos cosas que la pantalla no deja hacer, a propósito:
 *
 *   - Mandar sin haber mandado antes una prueba a una dirección propia. Un HTML
 *     que se ve bien acá se puede ver roto en Gmail, y del otro lado hay gente
 *     real: no hay "deshacer".
 *   - Editar una campaña ya enviada. El registro tiene que seguir describiendo
 *     lo que la gente recibió.
 */

const TAB = { campanas: "Campañas", contactos: "Contactos" } as const;
type Tab = keyof typeof TAB;

const VACIA = { name: "", subject: "", from_name: "", html: "" };

const EmailMarketing = () => {
  const [tab, setTab] = useState<Tab>("campanas");
  const [campanas, setCampanas] = useState<MarketingCampaign[]>([]);
  const [contactos, setContactos] = useState<MarketingContact[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // --- Campaña en edición ---------------------------------------------------
  const [form, setForm] = useState(VACIA);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [emailPrueba, setEmailPrueba] = useState("");
  const [pruebaHecha, setPruebaHecha] = useState(false);

  // --- Contactos ------------------------------------------------------------
  const [nuevos, setNuevos] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [agregando, setAgregando] = useState(false);

  const cargar = async () => {
    const [c, k] = await Promise.all([
      supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("marketing_contacts").select("*").order("created_at", { ascending: false }),
    ]);

    if (c.error ?? k.error) setError((c.error ?? k.error)!.message);

    setCampanas((c.data ?? []) as MarketingCampaign[]);
    setContactos((k.data ?? []) as MarketingContact[]);
    setCargando(false);
  };

  useEffect(() => {
    cargar();
  }, []);

  const suscriptos = useMemo(
    () => contactos.filter((c) => c.is_subscribed).length,
    [contactos]
  );

  const set = <K extends keyof typeof VACIA>(k: K, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    // Cambió el contenido: la prueba anterior ya no vale para lo que hay ahora.
    setPruebaHecha(false);
  };

  const nuevaCampana = () => {
    setForm(VACIA);
    setEditandoId(null);
    setPruebaHecha(false);
    setAviso("");
  };

  const editar = (c: MarketingCampaign) => {
    setForm({
      name: c.name,
      subject: c.subject,
      from_name: c.from_name ?? "",
      html: c.html,
    });
    setEditandoId(c.id);
    setPruebaHecha(false);
    setAviso("");
  };

  const guardar = async () => {
    setError("");
    setAviso("");

    if (!form.name.trim()) return setError("Ponele un nombre a la campaña.");
    if (!form.subject.trim()) return setError("Falta el asunto.");
    if (!form.html.trim()) return setError("Falta el contenido HTML.");

    setGuardando(true);

    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim(),
      from_name: form.from_name.trim() || null,
      html: form.html,
    };

    const { data, error } = editandoId
      ? await supabase.from("marketing_campaigns").update(payload).eq("id", editandoId).select("id").single()
      : await supabase.from("marketing_campaigns").insert(payload).select("id").single();

    setGuardando(false);

    if (error) return setError(error.message);

    setEditandoId(data.id);
    setAviso("Campaña guardada.");
    await cargar();
  };

  const invocar = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("marketing-send", { body });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);

    return data as { sent: number; failed: number; message?: string };
  };

  const enviarPrueba = async () => {
    setError("");
    setAviso("");

    if (!editandoId) return setError("Guardá la campaña antes de probarla.");
    if (!emailPrueba.trim()) return setError("Escribí a qué dirección mandar la prueba.");

    setEnviando(true);
    try {
      await invocar({ campaign_id: editandoId, test_email: emailPrueba.trim() });
      setPruebaHecha(true);
      setAviso(`Prueba enviada a ${emailPrueba.trim()}. Miralo en el celular antes de mandar.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  const enviar = async () => {
    setError("");
    setAviso("");

    if (!editandoId) return setError("Guardá la campaña antes de enviarla.");

    // Última barrera antes de escribirle a gente de verdad. La confirmación
    // dice el número exacto justamente para que se lea.
    const ok = window.confirm(
      `Vas a enviar "${form.subject}" a ${suscriptos} contactos suscriptos.\n\n` +
        `Esto no se puede deshacer. ¿Seguimos?`
    );
    if (!ok) return;

    setEnviando(true);
    try {
      const r = await invocar({ campaign_id: editandoId });
      setAviso(
        r.message ?? `Enviada a ${r.sent} contactos${r.failed ? `, ${r.failed} fallaron` : ""}.`
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  // --- Contactos ------------------------------------------------------------
  const agregarContactos = async () => {
    setError("");
    setAviso("");

    // Se aceptan pegados de cualquier lado: separados por coma, punto y coma,
    // espacios o saltos de línea.
    const emails = [
      ...new Set(
        nuevos
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      ),
    ];

    if (emails.length === 0) return setError("No encontré ningún email válido en lo que pegaste.");

    setAgregando(true);

    // `upsert` con ignoreDuplicates: volver a pegar una lista que ya tenías no
    // pisa nada ni resucita a quien se dio de baja.
    const { error } = await supabase
      .from("marketing_contacts")
      .upsert(
        emails.map((email) => ({ email, source: "manual" })),
        { onConflict: "email", ignoreDuplicates: true }
      );

    setAgregando(false);

    if (error) return setError(error.message);

    setNuevos("");
    setAviso(`${emails.length} ${emails.length === 1 ? "email procesado" : "emails procesados"}.`);
    await cargar();
  };

  const cambiarSuscripcion = async (c: MarketingContact) => {
    const { error } = await supabase
      .from("marketing_contacts")
      .update({
        is_subscribed: !c.is_subscribed,
        unsubscribed_at: c.is_subscribed ? new Date().toISOString() : null,
      })
      .eq("id", c.id);

    if (error) return setError(error.message);
    await cargar();
  };

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return contactos;

    return contactos.filter((c) => `${c.email} ${c.name ?? ""}`.toLowerCase().includes(q));
  }, [contactos, busqueda]);

  if (cargando) return <Loading />;

  const campanaActual = campanas.find((c) => c.id === editandoId);
  const yaEnviada = campanaActual?.status === "sent";

  return (
    <>
      <PageTitle>Email marketing</PageTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Contactos suscriptos" value={number(suscriptos)} />
        <Stat
          label="Dados de baja"
          value={number(contactos.length - suscriptos)}
          hint="No se borran: así no vuelven a entrar en una importación"
        />
        <Stat label="Campañas enviadas" value={number(campanas.filter((c) => c.status === "sent").length)} />
      </div>

      <div className="mb-6 flex gap-1 border-b border-neutral-200">
        {(Object.keys(TAB) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              tab === t
                ? "border-primary font-medium text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900"
            }`}
          >
            {TAB[t]}
          </button>
        ))}
      </div>

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

      {tab === "campanas" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">
                {editandoId ? "Editar campaña" : "Nueva campaña"}
              </h2>
              {editandoId && (
                <button onClick={nuevaCampana} className="text-xs text-neutral-500 hover:text-neutral-900">
                  + Nueva
                </button>
              )}
            </div>

            {yaEnviada && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Esta campaña ya se envió. Se puede mirar, pero no editar ni volver a mandar:
                el registro tiene que seguir describiendo lo que la gente recibió.
              </p>
            )}

            <fieldset disabled={yaEnviada} className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Nombre interno</label>
                <input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Newsletter agosto"
                  className="input"
                />
              </div>
              <div>
                <label className="label">Remitente</label>
                <input
                  value={form.from_name}
                  onChange={(e) => set("from_name", e.target.value)}
                  placeholder="VIGI"
                  className="input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Asunto</label>
                <input
                  value={form.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  placeholder="Nuevas cámaras con 20% off"
                  className="input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">HTML</label>
                <textarea
                  value={form.html}
                  onChange={(e) => set("html", e.target.value)}
                  rows={14}
                  placeholder="Pegá acá el HTML del mail…"
                  className="input font-mono text-xs"
                />
                <p className="mt-1 text-xs text-neutral-400">
                  Se reemplazan <code>{"{{name}}"}</code> y <code>{"{{email}}"}</code>. Si ponés{" "}
                  <code>{"{{unsubscribe}}"}</code> ahí va el link de baja; si no, se agrega solo al
                  final.
                </p>
              </div>
            </fieldset>

            {!yaEnviada && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-5">
                <button onClick={guardar} disabled={guardando} className="btn-primary">
                  {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear campaña"}
                </button>

                <input
                  value={emailPrueba}
                  onChange={(e) => setEmailPrueba(e.target.value)}
                  placeholder="tu@email.com"
                  className="input max-w-[13rem]"
                />
                <button onClick={enviarPrueba} disabled={enviando || !editandoId} className="btn-ghost">
                  Enviar prueba
                </button>

                <button
                  onClick={enviar}
                  disabled={enviando || !editandoId || !pruebaHecha || suscriptos === 0}
                  className="btn-primary ml-auto"
                  title={
                    !pruebaHecha
                      ? "Mandá primero una prueba a tu dirección"
                      : `Enviar a ${suscriptos} contactos`
                  }
                >
                  {enviando ? "Enviando…" : `Enviar a ${suscriptos}`}
                </button>
              </div>
            )}

            {!pruebaHecha && !yaEnviada && (
              <p className="mt-2 text-right text-xs text-neutral-400">
                Mandá una prueba antes de habilitar el envío.
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-medium">Preview</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Cómo se ve el HTML. El cliente de correo puede recortar estilos, así que la
              prueba por mail sigue siendo obligatoria.
            </p>

            <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200">
              {form.html.trim() ? (
                <iframe
                  // sandbox sin allow-scripts: el HTML de un mail no debería
                  // correr nada, y esto es contenido pegado a mano.
                  sandbox=""
                  srcDoc={form.html}
                  title="Vista previa del mail"
                  className="h-[28rem] w-full bg-white"
                />
              ) : (
                <div className="flex h-[28rem] items-center justify-center px-6 text-center">
                  <p className="text-sm text-neutral-400">Pegá el HTML para ver la preview.</p>
                </div>
              )}
            </div>
          </section>

          <section className="card overflow-hidden lg:col-span-3">
            <h2 className="px-5 pt-5 text-sm font-medium">Campañas</h2>

            {campanas.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-neutral-500">
                Todavía no hay campañas.
              </div>
            ) : (
              <table className="mt-4 w-full">
                <thead className="border-y border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="th">Nombre</th>
                    <th className="th">Asunto</th>
                    <th className="th">Estado</th>
                    <th className="th">Enviada</th>
                    <th className="th text-right">Enviados</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {campanas.map((c) => (
                    <tr key={c.id} className="transition hover:bg-neutral-50">
                      <td className="td font-medium text-neutral-900">{c.name}</td>
                      <td className="td text-neutral-600">{c.subject}</td>
                      <td className="td">
                        <Badge
                          tone={
                            c.status === "sent"
                              ? "green"
                              : c.status === "failed"
                                ? "red"
                                : c.status === "sending"
                                  ? "amber"
                                  : "neutral"
                          }
                        >
                          {c.status === "draft"
                            ? "borrador"
                            : c.status === "sending"
                              ? "enviando"
                              : c.status === "sent"
                                ? "enviada"
                                : "falló"}
                        </Badge>
                      </td>
                      <td className="td whitespace-nowrap text-neutral-500">
                        {c.sent_at ? dateTime(c.sent_at) : "—"}
                      </td>
                      <td className="td tabular text-right">
                        {number(c.sent_count)}
                        {c.failed_count > 0 && (
                          <span className="text-red-600"> · {number(c.failed_count)} fallaron</span>
                        )}
                      </td>
                      <td className="td text-right">
                        <button
                          onClick={() => editar(c)}
                          className="text-sm text-neutral-500 hover:text-neutral-900"
                        >
                          {c.status === "sent" ? "ver" : "editar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="card p-5">
            <h2 className="text-sm font-medium">Agregar contactos</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Pegá los emails separados por coma, espacio o salto de línea. Los repetidos se
              ignoran y no reactivan a quien se dio de baja.
            </p>

            <textarea
              value={nuevos}
              onChange={(e) => setNuevos(e.target.value)}
              rows={8}
              placeholder={"juan@mail.com\nana@mail.com"}
              className="input mt-4 font-mono text-xs"
            />

            <button
              onClick={agregarContactos}
              disabled={agregando || !nuevos.trim()}
              className="btn-primary mt-3 w-full"
            >
              {agregando ? "Agregando…" : "Agregar a la lista"}
            </button>
          </section>

          <section className="card overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between gap-3 p-5">
              <h2 className="text-sm font-medium">Lista</h2>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar…"
                className="input max-w-[14rem]"
              />
            </div>

            {filtrados.length === 0 ? (
              <div className="px-5 pb-10 text-center text-sm text-neutral-500">
                {contactos.length === 0 ? "La lista está vacía." : "Ningún contacto coincide."}
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 border-y border-neutral-200 bg-neutral-50">
                    <tr>
                      <th className="th">Email</th>
                      <th className="th">Origen</th>
                      <th className="th">Estado</th>
                      <th className="th"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filtrados.map((c) => (
                      <tr key={c.id} className="transition hover:bg-neutral-50">
                        <td className="td">
                          {c.email}
                          {c.name && <p className="text-xs text-neutral-400">{c.name}</p>}
                        </td>
                        <td className="td text-neutral-500">{c.source}</td>
                        <td className="td">
                          {c.is_subscribed ? (
                            <Badge tone="green">suscripto</Badge>
                          ) : (
                            <Badge tone="neutral">de baja</Badge>
                          )}
                        </td>
                        <td className="td text-right">
                          <button
                            onClick={() => cambiarSuscripcion(c)}
                            className="text-sm text-neutral-500 hover:text-neutral-900"
                          >
                            {c.is_subscribed ? "dar de baja" : "resuscribir"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {campanas.length === 0 && contactos.length === 0 && (
        <div className="mt-6">
          <Empty>
            Empezá agregando contactos y después armá tu primera campaña.
          </Empty>
        </div>
      )}
    </>
  );
};

export default EmailMarketing;
