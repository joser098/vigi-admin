import { useEffect, useMemo, useState } from "react";
import { supabase, traerTodo } from "@/lib/supabase";
import { money, number, dateTime } from "@/lib/format";
import { PageTitle, Badge, Stat, Loading, ErrorBox } from "@/components/ui";
import type { MeliListing, MeliListingStatus, MeliSettings } from "@/lib/types";

/**
 * Publicaciones en MercadoLibre.
 *
 * Quien habla con MercadoLibre es la Edge Function `meli-listings`: el token no
 * puede estar en el navegador. Esta pantalla elige qué publicar, revisa y
 * corrige lo que MercadoLibre pide, y aprieta los botones.
 *
 * Nada de acá toca la tienda: el precio de MercadoLibre vive en
 * `meli_listings` y se calcula aparte, con la comisión de MercadoLibre. El
 * precio de vigi.com.ar sigue saliendo de `products`, igual que siempre.
 *
 * El flujo de cada producto:
 *
 *   Preparar  → categoría sugerida por ML, título y precio con ganancia
 *   Validar   → ML revisa la publicación sin crearla y dice qué falta
 *   Publicar  → se crea en ML (vuelve a validar antes, por las dudas)
 */

type ProductoML = {
  id: string;
  model: string;
  title: string;
  provider: string | null;
  category: string;
  cost: number | null;
  price: number;
  thumbnail: string | null;
  is_active: boolean;
};

type Resultado = { product_id: string; ok: boolean; message?: string };

// De a cuántos productos se le manda a la function: cada uno son varias
// llamadas a MercadoLibre y una Edge Function tiene tiempo limitado.
const TANDA = 10;

// Tiene que estar cargada, tal cual, como Redirect URI en la aplicación de
// MercadoLibre.
const redirectUri = () => `${window.location.origin}/meli`;

// PKCE: la aplicación de MercadoLibre lo exige. El verifier es un secreto de
// un solo uso que se genera acá, se guarda en esta pestaña mientras se va a
// MercadoLibre a autorizar, y vuelve a la function para canjear el code. A
// MercadoLibre solo viaja su SHA-256 (el challenge).
const PKCE_KEY = "vigi.meli_pkce_verifier";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const nuevoPkce = async () => {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(hash)) };
};

const leerVerifier = () => {
  try {
    return sessionStorage.getItem(PKCE_KEY);
  } catch {
    return null;
  }
};

type Filtro = "todos" | "none" | MeliListingStatus;

const ESTADO: Record<"none" | MeliListingStatus, { label: string; tone: "neutral" | "green" | "amber" | "red" | "violet" }> = {
  none: { label: "Sin preparar", tone: "neutral" },
  draft: { label: "Borrador", tone: "neutral" },
  ready: { label: "Lista", tone: "violet" },
  error: { label: "Con error", tone: "red" },
  active: { label: "Activa", tone: "green" },
  paused: { label: "Pausada", tone: "amber" },
  under_review: { label: "En revisión", tone: "amber" },
  closed: { label: "Finalizada", tone: "neutral" },
  inactive: { label: "Inactiva", tone: "neutral" },
};

const publicada = (l?: MeliListing) => Boolean(l?.meli_item_id);

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

const invocar = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("meli-listings", { body });
  if (error) throw new Error(await mensajeDe(error));
  if (data?.error) throw new Error(data.error);
  return data as T;
};

/** Las causas que devolvió MercadoLibre, en lista legible. */
const causasDe = (errors: unknown): string[] => {
  if (!errors || typeof errors !== "object") return [];
  const e = errors as { message?: string; cause?: Array<{ message?: string; code?: string; type?: string }> };
  const todas = e.cause ?? [];
  const errores = todas.filter((c) => c?.type !== "warning");
  // Con un 400 que solo trae avisos, los avisos son la única pista.
  const causas = (errores.length ? errores : todas)
    .map((c) => (c?.type === "warning" ? "Aviso: " : "") + (c?.message ?? c?.code ?? ""))
    .filter((x) => x && x !== "Aviso: ");
  return causas.length ? causas : e.message ? [e.message] : [];
};

const margenPct = (l?: MeliListing) =>
  l?.net_profit != null && l.cost_basis ? Math.round((l.net_profit / l.cost_basis) * 100) : null;

// ---------------------------------------------------------------------------
// Conexión con la cuenta
// ---------------------------------------------------------------------------

type Estado =
  | {
      connected: true;
      user: { id: number; nickname: string; permalink: string; level: string | null };
      can_list?: boolean | null;
      list_codes?: string[];
      can_sell?: boolean | null;
      sell_codes?: string[];
      mercadoenvios?: string | null;
    }
  | { connected: false; auth_url: string | null; error?: string };

const Conexion = ({ estado, onConectar }: { estado: Estado | null; onConectar: () => void }) => {
  if (!estado) return <div className="card p-5 text-sm text-neutral-400">Consultando MercadoLibre…</div>;

  if (estado.connected) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Cuenta conectada</p>
          <p className="mt-1 text-sm">
            <a className="font-medium underline" href={estado.user.permalink} target="_blank" rel="noreferrer">
              {estado.user.nickname}
            </a>
            {estado.user.level && <span className="ml-2 text-neutral-400">reputación {estado.user.level}</span>}
          </p>
        </div>
        <div className="text-xs">
          <p>
            Puede publicar:{" "}
            <b className={estado.can_list === false ? "text-red-600" : "text-green-700"}>
              {estado.can_list === false ? "no" : estado.can_list ? "sí" : "—"}
            </b>
            {" · "}Mercado Envíos: <b>{estado.mercadoenvios ?? "—"}</b>
          </p>
          {[...(estado.list_codes ?? []), ...(estado.sell_codes ?? [])].length > 0 && (
            <p className="mt-1 text-red-600">
              MercadoLibre pide: {[...new Set([...(estado.list_codes ?? []), ...(estado.sell_codes ?? [])])].join(", ")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-5">
      <p className="text-sm font-medium">MercadoLibre no está conectado</p>
      {estado.error && <p className="text-xs text-neutral-500">{estado.error}</p>}
      <p className="text-xs text-neutral-500">
        Antes de conectar, la aplicación de MercadoLibre tiene que tener cargada esta Redirect URI, exacta:{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5">{redirectUri()}</code>
      </p>
      <button className="btn-primary" onClick={onConectar} disabled={!estado.auth_url}>
        Conectar cuenta de MercadoLibre
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const Configuracion = ({ settings, onGuardado }: { settings: MeliSettings; onGuardado: () => void }) => {
  const [form, setForm] = useState(settings);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setForm(settings), [settings]);

  const campo = <K extends keyof MeliSettings>(k: K, v: MeliSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setGuardando(true);
    setError("");
    const { error: e } = await supabase
      .from("meli_settings")
      .update({
        margin_pct: Number(form.margin_pct),
        taxes_pct: Number(form.taxes_pct),
        listing_type_id: form.listing_type_id,
        default_quantity: Number(form.default_quantity),
        free_shipping_min: Number(form.free_shipping_min),
        shipping_cost: Number(form.shipping_cost),
        rounding: Number(form.rounding),
        vat: form.vat,
        warranty_time: form.warranty_time,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setGuardando(false);
    if (e) return setError(e.message);
    onGuardado();
  };

  const num = (k: keyof MeliSettings, label: string, hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        className="input"
        value={String(form[k] ?? "")}
        onChange={(e) => campo(k, e.target.value as never)}
      />
      {hint && <span className="mt-1 block text-[11px] text-neutral-400">{hint}</span>}
    </label>
  );

  return (
    <details className="card p-5">
      <summary className="cursor-pointer text-sm font-medium">
        Configuración de precios · ganancia {number(settings.margin_pct)}% sobre el costo ·{" "}
        {settings.listing_type_id === "gold_pro" ? "Premium" : "Clásica"}
      </summary>

      <p className="mt-3 text-xs text-neutral-500">
        El precio de cada publicación es el menor que, después de la comisión real de MercadoLibre para esa
        categoría, el envío gratis y los impuestos, deja esta ganancia sobre el costo. Cambiar esto no cambia
        las publicaciones ya hechas: hay que usar <b>Actualizar precio</b>.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {num("margin_pct", "Ganancia neta sobre costo (%)")}
        {num("taxes_pct", "Impuestos y retenciones (%)", "IIBB y percepciones que descuenta ML")}
        <label className="block">
          <span className="label">Tipo de publicación</span>
          <select
            className="input"
            value={form.listing_type_id}
            onChange={(e) => campo("listing_type_id", e.target.value as MeliSettings["listing_type_id"])}
          >
            <option value="gold_special">Clásica</option>
            <option value="gold_pro">Premium (cuotas sin interés)</option>
          </select>
        </label>
        {num("free_shipping_min", "Envío gratis obligatorio desde ($)", "Verificar el valor vigente en ML")}
        {num("shipping_cost", "Costo estimado del envío gratis ($)", "Promedio que paga VIGI por envío")}
        {num("default_quantity", "Stock a publicar", "La base no tiene stock")}
        {num("rounding", "Redondear el precio a múltiplos de ($)")}
        <label className="block">
          <span className="label">IVA</span>
          <select className="input" value={form.vat} onChange={(e) => campo("vat", e.target.value)}>
            {["21 %", "10.5 %", "27 %", "0 %", "Exento"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Garantía</span>
          <input className="input" value={form.warranty_time} onChange={(e) => campo("warranty_time", e.target.value)} />
        </label>
      </div>

      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}

      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </details>
  );
};

// ---------------------------------------------------------------------------
// Edición de una publicación
// ---------------------------------------------------------------------------

type AtributoCat = { id: string; name: string; required: boolean; values: string[] };

type Candidato = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  thumbnail: string | null;
  exacto: boolean;
};

const Editor = ({
  producto,
  listing,
  onCambio,
  accion,
}: {
  producto: ProductoML;
  listing: MeliListing;
  onCambio: () => void;
  accion: (a: string, extra?: Record<string, unknown>) => Promise<void>;
}) => {
  const [form, setForm] = useState({
    title: listing.title ?? "",
    category_id: listing.category_id ?? "",
    category_name: listing.category_name ?? "",
    quantity: listing.quantity ?? 0,
    attributes: listing.attributes ?? {},
  });
  const [atributos, setAtributos] = useState<AtributoCat[] | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const esPublicada = publicada(listing);

  useEffect(() => {
    if (!form.category_id) return;
    let vivo = true;
    invocar<{ attributes: AtributoCat[] }>({ action: "attributes", category_id: form.category_id })
      .then((r) => vivo && setAtributos(r.attributes))
      .catch((e) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [form.category_id]);

  const guardar = async () => {
    setGuardando(true);
    setError("");
    const { error: e } = await supabase
      .from("meli_listings")
      .update({
        title: form.title.trim().slice(0, 60),
        category_id: form.category_id.trim(),
        category_name: form.category_name,
        attributes: form.attributes,
        ...(esPublicada ? {} : { quantity: Number(form.quantity) }),
      })
      .eq("product_id", producto.id);
    setGuardando(false);
    if (e) return setError(e.message);
    onCambio();
  };

  // El GTIN se busca en el catálogo de MercadoLibre, pero lo elige una
  // persona: dos productos con nombre parecido pueden tener códigos distintos.
  const buscarGtin = async () => {
    setBuscando(true);
    setError("");
    try {
      const r = await invocar<{ candidates: Candidato[] }>({ action: "catalog", product_id: producto.id });
      setCandidatos(r.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscando(false);
    }
  };

  const causas = causasDe(listing.errors);

  return (
    <div className="space-y-4 bg-neutral-50 px-5 py-5">
      {causas.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-medium text-red-700">MercadoLibre respondió:</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
            {causas.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="label">Título ({form.title.length}/60)</span>
          <input
            className="input"
            maxLength={60}
            value={form.title}
            disabled={esPublicada}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">Categoría de ML</span>
          <input
            className="input"
            value={form.category_id}
            disabled={esPublicada}
            onChange={(e) => setForm({ ...form, category_id: e.target.value, category_name: "" })}
          />
          <span className="mt-1 block text-[11px] text-neutral-400">{form.category_name || "id de categoría, ej. MLA5959"}</span>
        </label>
      </div>

      {listing.price != null && (
        <div className="grid gap-3 text-xs sm:grid-cols-6">
          {[
            ["Precio ML", money(listing.price)],
            ["Costo", money(listing.cost_basis)],
            ["Comisión ML", money(listing.fee_amount)],
            ["Envío", money(listing.shipping_cost)],
            ["Impuestos", money(listing.taxes_amount)],
            ["Ganancia", `${money(listing.net_profit)} (${margenPct(listing) ?? "—"}%)`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white px-3 py-2">
              <p className="text-neutral-500">{k}</p>
              <p className="tabular font-medium">{v}</p>
            </div>
          ))}
        </div>
      )}

      {!esPublicada && (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-neutral-600">
              GTIN (código de barras): <b>{form.attributes.GTIN || "sin cargar"}</b>
            </span>
            <button className="btn-ghost" onClick={buscarGtin} disabled={buscando}>
              {buscando ? "Buscando…" : "Buscar GTIN en el catálogo de ML"}
            </button>
          </div>
          {candidatos && (
            <div className="mt-2 space-y-1">
              {candidatos.length === 0 && (
                <p className="text-xs text-neutral-500">
                  No aparece en el catálogo. Cargá el código de la caja en el campo GTIN de abajo.
                </p>
              )}
              {candidatos.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-xs">
                  {c.thumbnail && <img src={c.thumbnail} alt="" className="size-8 rounded object-contain" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-neutral-500">
                      {c.brand} · modelo {c.model ?? "—"} · GTIN {c.gtin ?? "—"}
                      {c.exacto && <span className="ml-2 text-green-700">mismo modelo</span>}
                    </p>
                  </div>
                  <button
                    className="btn-ghost"
                    disabled={!c.gtin}
                    onClick={() => setForm({ ...form, attributes: { ...form.attributes, GTIN: c.gtin ?? "" } })}
                  >
                    Usar
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-neutral-400">Después de elegir, tocá Guardar cambios.</p>
            </div>
          )}
        </div>
      )}

      {!esPublicada && atributos && atributos.length > 0 && (
        <div>
          <p className="label">Atributos que pide la categoría</p>
          <p className="mb-2 text-[11px] text-neutral-400">
            Marca, modelo, IVA y ubicación se completan solos desde el producto. Lo que cargues acá tiene prioridad.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {atributos.map((a) => (
              <label key={a.id} className="block">
                <span className="text-xs text-neutral-600">
                  {a.name}
                  {a.required && <span className="text-red-600"> *</span>}
                </span>
                {a.values.length > 0 ? (
                  <select
                    className="input"
                    value={form.attributes[a.id] ?? ""}
                    onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [a.id]: e.target.value } })}
                  >
                    <option value="">(automático)</option>
                    {a.values.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    placeholder="(automático)"
                    value={form.attributes[a.id] ?? ""}
                    onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [a.id]: e.target.value } })}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-center gap-2">
        {esPublicada ? (
          <>
            <label className="flex items-center gap-2 text-xs">
              Stock
              <input
                type="number"
                min={0}
                className="input max-w-[5rem]"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              />
            </label>
            <button className="btn-ghost" onClick={() => accion("update", { quantity: Number(form.quantity) })}>
              Actualizar stock
            </button>
            {listing.status === "active" && (
              <button className="btn-ghost" onClick={() => accion("update", { status: "paused" })}>
                Pausar
              </button>
            )}
            {listing.status === "paused" && (
              <button className="btn-ghost" onClick={() => accion("update", { status: "active" })}>
                Activar
              </button>
            )}
            <button className="btn-ghost" onClick={() => accion("reprice")}>
              Actualizar precio
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
            <button className="btn-ghost" onClick={() => accion("quote")}>
              Recalcular precio
            </button>
            <button className="btn-ghost" onClick={() => accion("validate")}>
              Validar en ML
            </button>
            <button className="btn-primary" onClick={() => accion("publish")}>
              Publicar
            </button>
          </>
        )}
        {listing.permalink && (
          <a className="ml-auto text-xs underline" href={listing.permalink} target="_blank" rel="noreferrer">
            Ver en MercadoLibre
          </a>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

const Meli = () => {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [settings, setSettings] = useState<MeliSettings | null>(null);
  const [productos, setProductos] = useState<ProductoML[]>([]);
  const [listings, setListings] = useState<Record<string, MeliListing>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [fallos, setFallos] = useState<Resultado[]>([]);
  const [trabajando, setTrabajando] = useState("");

  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [abierto, setAbierto] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(100);

  const cargar = async () => {
    try {
      const [p, l, s] = await Promise.all([
        traerTodo<ProductoML>((desde, hasta) =>
          supabase
            .from("products")
            .select("id,model,title,provider,category,cost,price,thumbnail,is_active")
            .eq("is_active", true)
            .order("title")
            .range(desde, hasta)
        ),
        traerTodo<MeliListing>((desde, hasta) => supabase.from("meli_listings").select("*").range(desde, hasta)),
        supabase.from("meli_settings").select("*").eq("id", true).maybeSingle(),
      ]);
      if (s.error) throw new Error(s.error.message);

      setProductos(p);
      setListings(Object.fromEntries(l.map((x) => [x.product_id, x])));
      setSettings(s.data as MeliSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  const consultarEstado = () =>
    invocar<Estado>({ action: "status", redirect_uri: redirectUri() })
      .then(setEstado)
      .catch((e) => setEstado({ connected: false, auth_url: null, error: e.message }));

  useEffect(() => {
    // Vuelta de la autorización de MercadoLibre: ?code=TG-… en la URL. Se
    // canjea una sola vez y se limpia la URL para que un recargar no lo repita.
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      window.history.replaceState(null, "", "/meli");
      const verifier = leerVerifier();
      try {
        sessionStorage.removeItem(PKCE_KEY);
      } catch {
        // sin storage: el verifier ya se leyó
      }
      invocar({ action: "connect", code, redirect_uri: redirectUri(), code_verifier: verifier })
        .then(() => setAviso("Cuenta de MercadoLibre conectada."))
        .catch((e) => setError(`No se pudo conectar: ${e.message}`))
        .finally(consultarEstado);
    } else {
      consultarEstado();
    }
    cargar();
  }, []);

  // --- Acciones ---------------------------------------------------------------

  const correr = async (accion: string, ids: string[], extra: Record<string, unknown> = {}) => {
    if (ids.length === 0) return;
    setError("");
    setAviso("");
    setFallos([]);

    const resultados: Resultado[] = [];
    try {
      for (let i = 0; i < ids.length; i += TANDA) {
        setTrabajando(`${accion}: ${Math.min(i + TANDA, ids.length)} de ${ids.length}…`);
        const r = await invocar<{ results: Resultado[] }>({
          action: accion,
          product_ids: ids.slice(i, i + TANDA),
          ...extra,
        });
        resultados.push(...r.results);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando("");
    }

    const ok = resultados.filter((r) => r.ok).length;
    // Los que fallaron y los que salieron bien pero con algo para mirar
    // (por ejemplo, preparados sin GTIN).
    const mal = resultados.filter((r) => !r.ok || r.message);
    if (resultados.length) setAviso(`${ok} de ${resultados.length} sin problemas.`);
    setFallos(mal);
    await cargar();
  };

  const sincronizar = async () => {
    setError("");
    setAviso("");
    setTrabajando("Sincronizando con MercadoLibre…");
    try {
      const r = await invocar<{ synced: number; total: number }>({ action: "sync" });
      setAviso(`Sincronizadas ${r.synced} de ${r.total} publicaciones.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando("");
    }
  };

  const publicar = (ids: string[]) => {
    const listas = ids.filter((id) => listings[id] && !publicada(listings[id]));
    if (listas.length === 0) return setError("Ninguno de los elegidos está preparado y sin publicar.");
    const ok = window.confirm(
      `Vas a publicar ${listas.length} producto${listas.length === 1 ? "" : "s"} en MercadoLibre, a la vista de todos.\n\n` +
        "Antes de cada uno, MercadoLibre la valida: si algo falta, esa no se publica. ¿Seguimos?"
    );
    if (ok) correr("publish", listas);
  };

  // --- Listado ----------------------------------------------------------------

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      const l = listings[p.id];
      const est: "none" | MeliListingStatus = l?.status ?? "none";
      if (filtro !== "todos" && est !== filtro) return false;
      if (!q) return true;
      return [p.title, p.model, p.provider ?? "", p.category].some((x) => x.toLowerCase().includes(q));
    });
  }, [productos, listings, busqueda, filtro]);

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of productos) {
      const est = listings[p.id]?.status ?? "none";
      c[est] = (c[est] ?? 0) + 1;
    }
    return c;
  }, [productos, listings]);

  const ventas = Object.values(listings).reduce((t, l) => t + (l.sold_quantity ?? 0), 0);
  const sinCosto = productos.filter((p) => p.cost == null).length;

  const elegidosIds = [...elegidos];
  const alternar = (id: string) =>
    setElegidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const visibles = filas.slice(0, mostrar);
  const todosVisiblesElegidos = visibles.length > 0 && visibles.every((p) => elegidos.has(p.id));

  if (cargando) return <Loading />;

  return (
    <>
      <PageTitle
        action={
          <button className="btn-ghost" onClick={sincronizar} disabled={!!trabajando || !estado?.connected}>
            Sincronizar con MercadoLibre
          </button>
        }
      >
        MercadoLibre
      </PageTitle>

      <div className="mb-6 space-y-4">
        <Conexion
          estado={estado}
          onConectar={async () => {
            try {
              const { verifier, challenge } = await nuevoPkce();
              sessionStorage.setItem(PKCE_KEY, verifier);
              const r = await invocar<Estado>({
                action: "status",
                redirect_uri: redirectUri(),
                code_challenge: challenge,
              });
              if (!r.connected && r.auth_url) window.location.href = r.auth_url;
              else setEstado(r);
            } catch (e) {
              setError(`No se pudo iniciar la conexión: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
        />
        {settings && <Configuracion settings={settings} onGuardado={cargar} />}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Activas" value={number(conteo.active ?? 0)} hint={`${number(conteo.paused ?? 0)} pausadas`} />
        <Stat label="Listas para publicar" value={number(conteo.ready ?? 0)} hint={`${number(conteo.draft ?? 0)} en borrador`} />
        <Stat label="Con error" value={number(conteo.error ?? 0)} hint="Abrí la fila para ver qué pide ML" />
        <Stat label="Vendidas en ML" value={number(ventas)} hint="Según la última sincronización" />
      </div>

      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
      {aviso && <p className="mb-2 text-sm text-green-700">{aviso}</p>}
      {fallos.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <ul className="space-y-1 text-xs text-amber-800">
            {fallos.map((f) => {
              const p = productos.find((x) => x.id === f.product_id);
              return (
                <li key={f.product_id}>
                  <b>{p?.model ?? f.product_id}</b>: {f.message}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {trabajando && <p className="mb-4 text-sm text-neutral-500">{trabajando}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Buscar por modelo, marca o categoría"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select className="input max-w-[12rem]" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
          <option value="todos">Todos los estados</option>
          {Object.entries(ESTADO).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label} ({conteo[k] ?? 0})
            </option>
          ))}
        </select>

        <div className="ml-auto flex flex-wrap gap-2">
          <span className="self-center text-xs text-neutral-500">{elegidos.size} elegidos</span>
          <button className="btn-ghost" disabled={!!trabajando || !elegidos.size} onClick={() => correr("prepare", elegidosIds)}>
            Preparar
          </button>
          <button className="btn-ghost" disabled={!!trabajando || !elegidos.size} onClick={() => correr("validate", elegidosIds)}>
            Validar
          </button>
          <button
            className="btn-ghost"
            disabled={!!trabajando || !elegidos.size}
            onClick={() => correr("reprice", elegidosIds.filter((id) => publicada(listings[id])))}
          >
            Actualizar precio
          </button>
          <button className="btn-primary" disabled={!!trabajando || !elegidos.size} onClick={() => publicar(elegidosIds)}>
            Publicar
          </button>
        </div>
      </div>

      {sinCosto > 0 && (
        <p className="mb-3 text-xs text-neutral-500">
          {sinCosto} productos no tienen costo cargado: no se les puede calcular un precio con ganancia.
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-8">
                <input
                  type="checkbox"
                  checked={todosVisiblesElegidos}
                  onChange={() =>
                    setElegidos((s) => {
                      const n = new Set(s);
                      for (const p of visibles) {
                        if (todosVisiblesElegidos) n.delete(p.id);
                        else n.add(p.id);
                      }
                      return n;
                    })
                  }
                />
              </th>
              <th className="th">Producto</th>
              <th className="th text-right">Costo</th>
              <th className="th text-right">Precio web</th>
              <th className="th text-right">Precio ML</th>
              <th className="th text-right">Ganancia</th>
              <th className="th">Categoría ML</th>
              <th className="th">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visibles.map((p) => {
              const l = listings[p.id];
              const est = ESTADO[l?.status ?? "none"];
              const pct = margenPct(l);
              return (
                <FilaProducto
                  key={p.id}
                  producto={p}
                  listing={l}
                  elegido={elegidos.has(p.id)}
                  abierto={abierto === p.id}
                  onElegir={() => alternar(p.id)}
                  onAbrir={() => setAbierto(abierto === p.id ? null : p.id)}
                  estado={est}
                  pct={pct}
                  onCambio={cargar}
                  accion={(a, extra) => correr(a, [p.id], extra)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {filas.length > mostrar && (
        <div className="mt-4 text-center">
          <button className="btn-ghost" onClick={() => setMostrar((m) => m + 100)}>
            Mostrar más ({number(filas.length - mostrar)} restantes)
          </button>
        </div>
      )}
    </>
  );
};

const FilaProducto = ({
  producto: p,
  listing: l,
  elegido,
  abierto,
  onElegir,
  onAbrir,
  estado,
  pct,
  onCambio,
  accion,
}: {
  producto: ProductoML;
  listing?: MeliListing;
  elegido: boolean;
  abierto: boolean;
  onElegir: () => void;
  onAbrir: () => void;
  estado: { label: string; tone: "neutral" | "green" | "amber" | "red" | "violet" };
  pct: number | null;
  onCambio: () => void;
  accion: (a: string, extra?: Record<string, unknown>) => Promise<void>;
}) => (
  <>
    <tr className={`cursor-pointer hover:bg-neutral-50 ${abierto ? "bg-neutral-50" : ""}`} onClick={onAbrir}>
      <td className="td" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={elegido} onChange={onElegir} />
      </td>
      <td className="td">
        <div className="flex items-center gap-3">
          {p.thumbnail ? (
            <img src={p.thumbnail} alt="" className="size-9 shrink-0 rounded object-contain" loading="lazy" />
          ) : (
            <div className="size-9 shrink-0 rounded bg-neutral-100" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{p.model}</p>
            <p className="truncate text-xs text-neutral-500">
              {p.provider} · {p.category}
            </p>
          </div>
        </div>
      </td>
      <td className="td tabular text-right">{money(p.cost)}</td>
      <td className="td tabular text-right">{money(p.price)}</td>
      <td className="td tabular text-right font-medium">{money(l?.price)}</td>
      <td className={`td tabular text-right ${l?.net_profit != null && l.net_profit < 0 ? "text-red-600" : ""}`}>
        {l?.net_profit != null ? `${money(l.net_profit)} · ${pct}%` : "—"}
      </td>
      <td className="td text-xs text-neutral-600">{l?.category_name ?? l?.category_id ?? "—"}</td>
      <td className="td">
        <Badge tone={estado.tone}>{estado.label}</Badge>
        {l?.sold_quantity ? <span className="ml-2 text-xs text-neutral-500">{l.sold_quantity} vendidas</span> : null}
        {l?.synced_at && <p className="mt-0.5 text-[10px] text-neutral-400">{dateTime(l.synced_at)}</p>}
      </td>
    </tr>
    {abierto && (
      <tr>
        <td colSpan={8} className="p-0">
          {l ? (
            <Editor key={l.updated_at} producto={p} listing={l} onCambio={onCambio} accion={accion} />
          ) : (
            <div className="bg-neutral-50 px-5 py-5 text-sm">
              <p className="text-neutral-600">
                Todavía no está preparada. Preparar le busca la categoría en MercadoLibre, arma el título y
                calcula el precio con ganancia.
              </p>
              <button className="btn-primary mt-3" onClick={() => accion("prepare")} disabled={p.cost == null}>
                Preparar
              </button>
              {p.cost == null && <p className="mt-2 text-xs text-red-600">Falta el costo del producto.</p>}
            </div>
          )}
        </td>
      </tr>
    )}
  </>
);

export default Meli;
