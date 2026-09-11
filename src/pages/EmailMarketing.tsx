import { useEffect, useMemo, useState } from "react";
import { supabase, traerTodo } from "@/lib/supabase";
import { number, money, date, dateTime } from "@/lib/format";
import { PageTitle, Stat, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import {
  PLANTILLAS,
  ORDEN_PLANTILLAS,
  slug,
  type PlantillaId,
  type Ajustes,
} from "@/lib/emailTemplates";
import type { MarketingCampaign, MarketingContact, Product, Coupon } from "@/lib/types";

// Los campos de `Ajustes` que son texto libre y se editan con un input. El
// cupón no entra: es una fila de la base, se elige de una lista.
type CampoTexto = "preheader" | "titulo" | "bajada" | "cta" | "utm";

/**
 * Email marketing.
 *
 * Quien manda es la Edge Function `marketing-send`, nunca el navegador: la API
 * key de Resend no puede estar en el bundle. Esta pantalla arma la campaña,
 * muestra la preview y aprieta el botón.
 *
 * Tres cosas que la pantalla no deja hacer, a propósito:
 *
 *   - Mandar sin haber mandado antes una prueba a una dirección propia. Un HTML
 *     que se ve bien acá se puede ver roto en Gmail, y del otro lado hay gente
 *     real: no hay "deshacer".
 *   - Editar una campaña ya enviada, ni una que está a mitad de camino. El
 *     registro tiene que seguir describiendo lo que la gente recibió, y los que
 *     ya la recibieron no pueden haber recibido otra cosa que los de mañana.
 *   - Pasarse de la cuota diaria de Resend. En el plan gratuito son 100 mails
 *     por día **compartidos con los transaccionales de la API**, así que una
 *     lista de mil contactos sale en tandas.
 *
 * Todo lo que puede pasar de mil filas —contactos, envíos— se pide con
 * `traerTodo`. PostgREST corta en 1000 y no avisa: con 1200 contactos, una
 * consulta común devuelve 1000 y parece completa.
 */

const TAB = { campanas: "Campañas", armar: "Armar con productos", contactos: "Contactos" } as const;
type Tab = keyof typeof TAB;

// Cuota del plan gratuito de Resend y tamaño de tanda por defecto. Están
// duplicados en la Edge Function, que es la que manda de verdad: acá son para
// pintar los números antes de apretar el botón.
const LIMITE_DIARIO = 100;
const TANDA = 85;

// "Vigi" y no vacío: sin nombre de remitente, la bandeja muestra la parte de
// antes del arroba de la dirección —"marketing"—, que no le dice nada a nadie.
const VACIA = { name: "", subject: "", from_name: "Vigi", html: "" };

// Más de esto en un mail no se lee, y la grilla se vuelve un catálogo.
const MAX_PRODUCTOS = 8;

const medianocheUTC = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

const EmailMarketing = () => {
  const [tab, setTab] = useState<Tab>("campanas");
  const [campanas, setCampanas] = useState<MarketingCampaign[]>([]);
  const [contactos, setContactos] = useState<MarketingContact[]>([]);
  const [productos, setProductos] = useState<Product[]>([]);
  const [cupones, setCupones] = useState<Coupon[]>([]);
  // Emails ya alcanzados por cada campaña que todavía no terminó. Solo de
  // esas: una campaña en "sent" no tiene pendientes por definición, y traer
  // sus envíos sería cargar el historial entero al navegador.
  const [alcanzados, setAlcanzados] = useState<Record<string, Set<string>>>({});
  const [hoy, setHoy] = useState(0);
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
  const [tamanoTanda, setTamanoTanda] = useState(TANDA);

  // --- Armador de plantillas ------------------------------------------------
  const [plantilla, setPlantilla] = useState<PlantillaId>("grilla");
  const [ajustes, setAjustes] = useState<Ajustes>(PLANTILLAS.grilla.sugerido);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [busquedaProd, setBusquedaProd] = useState("");

  // --- Contactos ------------------------------------------------------------
  const [nuevos, setNuevos] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [agregando, setAgregando] = useState(false);

  const cargar = async () => {
    try {
      const [c, k, p, n, cu] = await Promise.all([
        supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false }),

        traerTodo<MarketingContact>((desde, hasta) =>
          supabase
            .from("marketing_contacts")
            .select("*")
            .order("created_at", { ascending: false })
            .range(desde, hasta)
        ),

        // Solo lo que puede ir en un mail: activo y con foto. Un producto sin
        // thumbnail deja un hueco gris en la tarjeta.
        traerTodo<Product>((desde, hasta) =>
          supabase
            .from("products")
            .select(
              "id,model,title,category,thumbnail,price,effective_price,discount,has_promotion,is_active"
            )
            .eq("is_active", true)
            .not("thumbnail", "is", null)
            .order("title")
            .range(desde, hasta)
        ),

        // Cuántos mails salieron hoy. Desde la medianoche UTC, que es cuando
        // Resend reinicia la cuenta.
        supabase
          .from("marketing_sends")
          .select("id", { count: "exact", head: true })
          .eq("status", "sent")
          .gte("created_at", medianocheUTC()),

        // Los cupones activos, para poder colgarle uno a la campaña. Es lo
        // único que después contesta "¿esto vendió?": el código se tipea en el
        // carrito y cada canje queda en coupon_redemptions con su orden.
        supabase.from("coupons").select("*").eq("is_active", true).order("code"),
      ]);

      if (c.error) throw new Error(c.error.message);

      const listaCampanas = (c.data ?? []) as MarketingCampaign[];
      const abiertas = listaCampanas.filter((x) => x.status !== "sent").map((x) => x.id);

      const envios = abiertas.length
        ? await traerTodo<{ campaign_id: string; email: string }>((desde, hasta) =>
            supabase
              .from("marketing_sends")
              .select("campaign_id,email")
              .in("campaign_id", abiertas)
              .order("created_at", { ascending: true })
              .range(desde, hasta)
          )
        : [];

      const mapa: Record<string, Set<string>> = {};
      for (const e of envios) {
        (mapa[e.campaign_id] ??= new Set()).add(String(e.email).toLowerCase());
      }

      setCampanas(listaCampanas);
      setContactos(k);
      setProductos(p);
      setAlcanzados(mapa);
      setHoy(n.count ?? 0);
      setCupones((cu.data ?? []) as Coupon[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const suscriptos = useMemo(() => contactos.filter((c) => c.is_subscribed), [contactos]);

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
    setTab("campanas");
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

    return data as {
      sent: number;
      failed: number;
      remaining?: number;
      done?: boolean;
      sent_today?: number;
      message?: string;
    };
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
      setAviso(
        `Prueba enviada a ${emailPrueba.trim()}. Miralo en el celular y fijate que llegue firmado ` +
          `"${form.from_name.trim() || "Vigi"}" antes de mandar.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  // --- Envío por tandas -----------------------------------------------------
  // La lista no sale de una: son 100 mails por día en el plan gratuito de
  // Resend, compartidos con los transaccionales de la API. Cada tanda le manda
  // a los que todavía no la recibieron, así que se puede seguir mañana sin que
  // nadie la reciba dos veces.
  const yaRecibieron = editandoId ? (alcanzados[editandoId] ?? new Set<string>()) : new Set<string>();
  const pendientes = suscriptos.filter((c) => !yaRecibieron.has(c.email.toLowerCase()));
  const alcanzadosCount = suscriptos.length - pendientes.length;
  const disponibleHoy = Math.max(0, LIMITE_DIARIO - hoy);
  const vanAhora = Math.min(tamanoTanda, disponibleHoy, pendientes.length);

  const enviar = async () => {
    setError("");
    setAviso("");

    if (!editandoId) return setError("Guardá la campaña antes de enviarla.");
    if (vanAhora === 0) return setError("No hay a quién mandarle hoy.");

    // Última barrera antes de escribirle a gente de verdad. La confirmación
    // dice los números exactos justamente para que se lean.
    const ok = window.confirm(
      `Vas a enviar "${form.subject}" a ${vanAhora} contactos.\n\n` +
        `Después de esta tanda quedan ${pendientes.length - vanAhora} pendientes.\n` +
        `Esto no se puede deshacer. ¿Seguimos?`
    );
    if (!ok) return;

    setEnviando(true);
    try {
      const r = await invocar({ campaign_id: editandoId, limit: vanAhora });
      setAviso(r.message ?? `Enviada a ${r.sent} contactos${r.failed ? `, ${r.failed} fallaron` : ""}.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  // --- Armador de plantillas ------------------------------------------------
  const cambiarPlantilla = (id: PlantillaId) => {
    setPlantilla(id);
    // Los textos sugeridos son parte de la plantilla: cambiar de plantilla y
    // quedarse con el título de la anterior deja el mail descolgado. La
    // etiqueta de campaña y el cupón sí se conservan — no dependen de cómo se
    // vea el mail, y volver a elegirlos en cada prueba de plantilla es la
    // clase de paso que se olvida.
    setAjustes((a) => ({ ...PLANTILLAS[id].sugerido, utm: a.utm, cupon: a.cupon }));
  };

  const elegirCupon = (id: string) => {
    const c = cupones.find((x) => x.id === id);

    setAjustes((a) => ({
      ...a,
      cupon: c
        ? {
            code: c.code,
            kind: c.kind,
            value: c.value,
            min_purchase: c.min_purchase,
            max_discount: c.max_discount,
            ends_at: c.ends_at,
          }
        : null,
      // La etiqueta de UTM sigue al cupón: así el corte de Cupones y el de
      // utm_campaign hablan de lo mismo y se pueden cruzar.
      utm: c ? slug(c.code) : a.utm,
    }));
  };

  const alternar = (id: string) =>
    setElegidos((e) =>
      e.includes(id) ? e.filter((x) => x !== id) : e.length >= MAX_PRODUCTOS ? e : [...e, id]
    );

  const mover = (i: number, delta: number) =>
    setElegidos((e) => {
      const j = i + delta;
      if (j < 0 || j >= e.length) return e;

      const copia = [...e];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });

  const seleccionados = useMemo(
    () => elegidos.map((id) => productos.find((p) => p.id === id)).filter(Boolean) as Product[],
    [elegidos, productos]
  );

  const htmlArmado = useMemo(
    () => (seleccionados.length ? PLANTILLAS[plantilla].armar(seleccionados, ajustes) : ""),
    [seleccionados, plantilla, ajustes]
  );

  const usarHtml = () => {
    if (!htmlArmado) return setError("Elegí al menos un producto.");

    setForm((f) => ({
      ...f,
      html: htmlArmado,
      // El asunto y el nombre interno solo se completan si están vacíos: si ya
      // los escribiste, regenerar el HTML no te los pisa.
      subject: f.subject.trim() || ajustes.titulo,
      name:
        f.name.trim() ||
        `${ajustes.utm} · ${PLANTILLAS[plantilla].nombre} · ${new Date().toLocaleDateString("es-AR")}`,
    }));
    setPruebaHecha(false);
    setTab("campanas");
    setAviso("HTML generado. Revisalo, guardá y mandate una prueba.");
  };

  const filtradosProd = useMemo(() => {
    const q = busquedaProd.trim().toLowerCase();
    const base = q
      ? productos.filter((p) => `${p.title} ${p.model} ${p.category}`.toLowerCase().includes(q))
      : productos;

    return base.slice(0, 60);
  }, [productos, busquedaProd]);

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
  const cerrada = campanaActual?.status === "sent";
  const enCurso = campanaActual?.status === "sending";
  const editable = !cerrada && !enCurso;

  return (
    <>
      <PageTitle>Email marketing</PageTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Contactos suscriptos" value={number(suscriptos.length)} />
        <Stat
          label="Dados de baja"
          value={number(contactos.length - suscriptos.length)}
          hint="No se borran: así no vuelven a entrar en una importación"
        />
        <Stat
          label="Enviados hoy"
          value={`${number(hoy)} / ${LIMITE_DIARIO}`}
          hint="Cuota diaria de Resend, compartida con los mails de compra"
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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setTab("armar")}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  Armar con productos
                </button>
                {editandoId && (
                  <button onClick={nuevaCampana} className="text-xs text-neutral-500 hover:text-neutral-900">
                    + Nueva
                  </button>
                )}
              </div>
            </div>

            {cerrada && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Esta campaña ya se envió. Se puede mirar, pero no editar ni volver a mandar:
                el registro tiene que seguir describiendo lo que la gente recibió.
              </p>
            )}

            {enCurso && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Esta campaña está a mitad de camino: {number(alcanzadosCount)} ya la recibieron y
                faltan {number(pendientes.length)}. El contenido queda congelado — los de mañana
                tienen que recibir lo mismo que los de hoy.
              </p>
            )}

            <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
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
                  placeholder="Vigi"
                  className="input"
                />
                <p className="mt-1 text-xs text-neutral-400">
                  El nombre que se ve en la bandeja: <b>{form.from_name.trim() || "Vigi"}</b>. Si se
                  deja vacío, el correo llega firmado con lo que dice la dirección
                  (<code>marketing</code>), que no le dice nada a nadie.
                </p>
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

            {!cerrada && (
              <div className="mt-5 space-y-4 border-t border-neutral-200 pt-5">
                <div className="flex flex-wrap items-center gap-3">
                  {editable && (
                    <button onClick={guardar} disabled={guardando} className="btn-primary">
                      {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear campaña"}
                    </button>
                  )}

                  <input
                    value={emailPrueba}
                    onChange={(e) => setEmailPrueba(e.target.value)}
                    placeholder="tu@email.com"
                    className="input max-w-[13rem]"
                  />
                  <button onClick={enviarPrueba} disabled={enviando || !editandoId} className="btn-ghost">
                    Enviar prueba
                  </button>
                </div>

                {/* --- Tandas ------------------------------------------------ */}
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">Envío por tandas</h3>
                    <p className="text-xs text-neutral-500">
                      Resend gratis manda {LIMITE_DIARIO} por día, y los comparte con los mails de
                      compra. Hoy quedan <b>{number(disponibleHoy)}</b>.
                    </p>
                  </div>

                  <div className="mb-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-xs text-neutral-500">Ya la recibieron</p>
                      <p className="tabular text-lg font-medium">{number(alcanzadosCount)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-xs text-neutral-500">Faltan</p>
                      <p className="tabular text-lg font-medium">{number(pendientes.length)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-xs text-neutral-500">Total suscriptos</p>
                      <p className="tabular text-lg font-medium">{number(suscriptos.length)}</p>
                    </div>
                  </div>

                  <div className="mb-4 h-2 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${suscriptos.length ? (alcanzadosCount / suscriptos.length) * 100 : 0}%`,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="label mb-0">Tanda de</label>
                    <input
                      type="number"
                      min={1}
                      max={LIMITE_DIARIO}
                      value={tamanoTanda}
                      onChange={(e) => setTamanoTanda(Number(e.target.value))}
                      className="input max-w-[6rem]"
                    />

                    <button
                      onClick={enviar}
                      disabled={enviando || !editandoId || !pruebaHecha || vanAhora === 0}
                      className="btn-primary ml-auto"
                      title={
                        !pruebaHecha
                          ? "Mandá primero una prueba a tu dirección"
                          : vanAhora === 0
                            ? "No queda cupo hoy o no queda nadie pendiente"
                            : `Enviar a ${vanAhora} contactos`
                      }
                    >
                      {enviando ? "Enviando…" : `Enviar ${number(vanAhora)} ahora`}
                    </button>
                  </div>

                  {pendientes.length > 0 && vanAhora < pendientes.length && (
                    <p className="mt-2 text-right text-xs text-neutral-500">
                      Después de esta tanda quedan {number(pendientes.length - vanAhora)}. Volvé
                      mañana y apretá de nuevo: nadie la recibe dos veces.
                    </p>
                  )}

                  {!pruebaHecha && (
                    <p className="mt-2 text-right text-xs text-neutral-400">
                      Mandá una prueba antes de habilitar el envío.
                    </p>
                  )}
                </div>
              </div>
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
                    <th className="th text-right">Faltan</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {campanas.map((c) => {
                    // Una campaña cerrada no tiene pendientes por definición;
                    // de las abiertas, los pendientes son los suscriptos que no
                    // figuran en marketing_sends.
                    const faltan =
                      c.status === "sent"
                        ? 0
                        : suscriptos.filter(
                            (s) => !(alcanzados[c.id] ?? new Set()).has(s.email.toLowerCase())
                          ).length;

                    return (
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
                                ? "en tandas"
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
                        <td className="td tabular text-right text-neutral-500">
                          {faltan > 0 ? number(faltan) : "—"}
                        </td>
                        <td className="td text-right">
                          <button
                            onClick={() => editar(c)}
                            className="text-sm text-neutral-500 hover:text-neutral-900"
                          >
                            {c.status === "sent" ? "ver" : c.status === "sending" ? "seguir" : "editar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : tab === "armar" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* --- Elegir productos --------------------------------------- */}
          <section className="card p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">Productos</h2>
              <span className="text-xs text-neutral-500">
                {elegidos.length} / {MAX_PRODUCTOS}
              </span>
            </div>

            <input
              value={busquedaProd}
              onChange={(e) => setBusquedaProd(e.target.value)}
              placeholder="Buscar por título, modelo o categoría…"
              className="input"
            />

            <div className="mt-3 max-h-[26rem] space-y-1 overflow-y-auto pr-1">
              {filtradosProd.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-400">
                  {productos.length === 0
                    ? "No hay productos activos con foto."
                    : "Ningún producto coincide."}
                </p>
              ) : (
                filtradosProd.map((p) => {
                  const activo = elegidos.includes(p.id);

                  return (
                    <button
                      key={p.id}
                      onClick={() => alternar(p.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left transition ${
                        activo
                          ? "border-primary bg-neutral-50"
                          : "border-transparent hover:bg-neutral-50"
                      }`}
                    >
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="size-9 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="size-9 shrink-0 rounded bg-neutral-100" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-900">{p.title}</span>
                        <span className="block text-xs text-neutral-500">
                          {money(p.effective_price)}
                          {p.has_promotion && p.discount >= 1 && (
                            <span className="text-amber-700"> · {p.discount}% off</span>
                          )}
                        </span>
                      </span>
                      <span className={`text-sm ${activo ? "text-primary" : "text-neutral-300"}`}>
                        {activo ? "✓" : "+"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {elegidos.length >= MAX_PRODUCTOS && (
              <p className="mt-2 text-xs text-neutral-400">
                Con más de {MAX_PRODUCTOS} el mail deja de leerse y pasa a ser un catálogo.
              </p>
            )}
          </section>

          {/* --- Plantilla y textos ------------------------------------- */}
          <section className="card p-5">
            <h2 className="text-sm font-medium">Plantilla</h2>

            <div className="mt-3 space-y-2">
              {ORDEN_PLANTILLAS.map((id) => (
                <button
                  key={id}
                  onClick={() => cambiarPlantilla(id)}
                  className={`block w-full rounded-lg border px-3 py-2 text-left transition ${
                    plantilla === id
                      ? "border-primary bg-neutral-50"
                      : "border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  <span className="block text-sm font-medium text-neutral-900">
                    {PLANTILLAS[id].nombre}
                  </span>
                  <span className="block text-xs text-neutral-500">{PLANTILLAS[id].descripcion}</span>
                  <span className="mt-1 block text-xs text-neutral-400">{PLANTILLAS[id].ideal}</span>
                </button>
              ))}
            </div>

            {seleccionados.length > 0 && (
              <div className="mt-5">
                <h3 className="label">
                  Orden
                  {plantilla === "destacado" && (
                    <span className="ml-1 font-normal text-neutral-400">
                      — el primero va grande arriba
                    </span>
                  )}
                </h3>
                <ol className="mt-1 space-y-1">
                  {seleccionados.map((p, i) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5"
                    >
                      <span className="tabular w-4 text-xs text-neutral-400">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
                        {p.title}
                      </span>
                      <button
                        onClick={() => mover(i, -1)}
                        disabled={i === 0}
                        className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => mover(i, 1)}
                        disabled={i === seleccionados.length - 1}
                        className="px-1 text-neutral-400 hover:text-neutral-900 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => alternar(p.id)}
                        className="px-1 text-neutral-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* --- Cómo se mide ------------------------------------------- */}
            <div className="mt-5 border-t border-neutral-200 pt-5">
              <label className="label">Cupón de la campaña</label>
              <select
                value={cupones.find((c) => c.code === ajustes.cupon?.code)?.id ?? ""}
                onChange={(e) => elegirCupon(e.target.value)}
                className="input"
              >
                <option value="">Sin cupón — no vas a poder medir las ventas</option>
                {cupones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.kind === "percentage" ? `${c.value}%` : money(c.value)} off
                    {c.ends_at ? ` · hasta ${date(c.ends_at)}` : ""}
                  </option>
                ))}
              </select>

              {cupones.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  No hay cupones activos. Creá uno en <b>Cupones</b> y volvé: es lo único que
                  después contesta si el mail vendió.
                </p>
              ) : ajustes.cupon ? (
                <p className="mt-1 text-xs text-neutral-500">
                  El mail muestra el código y dice que va en el carrito. Cada venta con{" "}
                  <b>{ajustes.cupon.code.toUpperCase()}</b> queda en <b>Cupones</b> con su monto:
                  ese es el número que dice si conviene pagar Resend.
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-400">
                  Sin cupón el mail sale igual, pero no hay forma de saber qué ventas trajo. El
                  descuento además es lo que hace que abran.
                </p>
              )}
            </div>

            <div className="mt-5 space-y-3 border-t border-neutral-200 pt-5">
              {(
                [
                  ["titulo", "Título", "Nuevas cámaras en Vigi"],
                  ["bajada", "Bajada", "Una o dos frases debajo del título"],
                  ["cta", "Texto del botón", "Ver el catálogo"],
                  ["preheader", "Vista previa", "Lo que se lee al lado del asunto en la bandeja"],
                  ["utm", "Etiqueta de campaña", "mail-septiembre"],
                ] as Array<[CampoTexto, string, string]>
              ).map(([campo, etiqueta, ph]) => (
                <div key={campo}>
                  <label className="label">{etiqueta}</label>
                  {campo === "bajada" ? (
                    <textarea
                      value={ajustes[campo]}
                      onChange={(e) => setAjustes((a) => ({ ...a, [campo]: e.target.value }))}
                      rows={3}
                      placeholder={ph}
                      className="input"
                    />
                  ) : (
                    <input
                      value={ajustes[campo]}
                      onChange={(e) => setAjustes((a) => ({ ...a, [campo]: e.target.value }))}
                      placeholder={ph}
                      className="input"
                    />
                  )}
                  {campo === "utm" && (
                    <p className="mt-1 text-xs text-neutral-400">
                      Va en <code>utm_campaign</code> de cada link. Hoy la tienda no lee los UTM
                      —no hay GA4—, así que esto todavía no reporta nada solo; queda etiquetado
                      para cuando se conecte.
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={usarHtml}
              disabled={!htmlArmado}
              className="btn-primary mt-4 w-full"
            >
              Usar en la campaña
            </button>

            <p className="mt-2 text-xs text-neutral-400">
              El pie con envío, garantía, despacho y medios de pago lo pone la plantilla, con los
              datos reales de la tienda. El precio tachado sale del descuento cargado en el
              producto: si no tiene, no aparece.
            </p>
          </section>

          {/* --- Preview ------------------------------------------------- */}
          <section className="card p-5">
            <h2 className="text-sm font-medium">Preview</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Se actualiza a medida que elegís. Las fotos son las mismas que muestra la tienda.
            </p>

            <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200">
              {htmlArmado ? (
                <iframe
                  sandbox=""
                  srcDoc={htmlArmado}
                  title="Vista previa de la plantilla"
                  className="h-[36rem] w-full bg-white"
                />
              ) : (
                <div className="flex h-[36rem] items-center justify-center px-6 text-center">
                  <p className="text-sm text-neutral-400">Elegí productos para ver el mail.</p>
                </div>
              )}
            </div>
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
              <h2 className="text-sm font-medium">
                Lista <span className="text-neutral-400">({number(contactos.length)})</span>
              </h2>
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
