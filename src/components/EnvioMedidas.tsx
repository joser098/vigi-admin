import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { dateTime } from "@/lib/format";
import { meliSearchUrl } from "@/lib/meli";
import {
  DIMS_SOURCE_LABEL,
  aCmEntero,
  describirBulto,
  fichaOficialUrl,
  kgAGramos,
  leerNumero,
} from "@/lib/envio";
import type { DimsSource, Product, ShippingProfile } from "@/lib/types";
import { Badge } from "./ui";

type Datos = Pick<
  Product,
  "weight_grams" | "height_cm" | "width_cm" | "length_cm" | "dims_source" | "dims_url" | "dims_checked_at"
>;

type Sugerencia = {
  found: boolean;
  weight_grams?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  length_cm?: number | null;
  package?: boolean;
  origin?: string;
  url?: string | null;
};

type Form = { kg: string; alto: string; ancho: string; largo: string; source: DimsSource; url: string };

const VACIO: Datos = {
  weight_grams: null,
  height_cm: null,
  width_cm: null,
  length_cm: null,
  dims_source: null,
  dims_url: null,
  dims_checked_at: null,
};

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

const aForm = (d: Datos): Form => ({
  kg: d.weight_grams ? String(d.weight_grams / 1000).replace(".", ",") : "",
  alto: d.height_cm ? String(d.height_cm) : "",
  ancho: d.width_cm ? String(d.width_cm) : "",
  largo: d.length_cm ? String(d.length_cm) : "",
  source: d.dims_source ?? "official",
  url: d.dims_url ?? "",
});

/**
 * Peso y medidas del bulto de envío.
 *
 * Igual que el precio de MercadoLibre: el panel lleva a la fuente y el dato lo
 * confirma una persona. Si el producto no tiene medidas propias, se usa el
 * perfil de caja de su categoría (página Envíos).
 *
 * Todavía NO lo usa ninguna cotización: Andreani sigue con su bulto fijo.
 */
export const EnvioMedidas = ({
  productId,
  model,
  provider,
  category,
  inicial,
}: {
  productId: string;
  model: string;
  provider: string | null;
  category: string;
  inicial: Datos;
}) => {
  const [datos, setDatos] = useState<Datos>(inicial);
  const [form, setForm] = useState<Form>(aForm(inicial));
  const [perfil, setPerfil] = useState<ShippingProfile | null | undefined>(undefined);
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // El perfil que aplica si no hay medidas propias.
  useEffect(() => {
    let vivo = true;
    supabase
      .from("categories")
      .select("shipping_profiles(*)")
      .eq("name", category)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo) return;
        const p = (data as { shipping_profiles: ShippingProfile | null } | null)?.shipping_profiles;
        setPerfil(p ?? null);
      });
    return () => {
      vivo = false;
    };
  }, [category]);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async (fila: Datos) => {
    setGuardando(true);
    setError("");
    const { error: err } = await supabase.from("products").update(fila).eq("id", productId);
    if (err) {
      setError(err.message);
    } else {
      setDatos(fila);
      setForm(aForm(fila));
      setSugerencia(null);
    }
    setGuardando(false);
  };

  const confirmar = () => {
    const kg = leerNumero(form.kg);
    const alto = leerNumero(form.alto);
    const ancho = leerNumero(form.ancho);
    const largo = leerNumero(form.largo);
    // La base exige las cuatro o ninguna.
    if (!kg || !alto || !ancho || !largo) {
      setError("Completá peso, alto, ancho y largo.");
      return;
    }
    if (kg > 100) {
      setError("El peso va en kg: ¿no lo escribiste en gramos?");
      return;
    }
    guardar({
      weight_grams: kgAGramos(kg),
      height_cm: aCmEntero(alto),
      width_cm: aCmEntero(ancho),
      length_cm: aCmEntero(largo),
      dims_source: form.source,
      dims_url: form.url.trim() || null,
      dims_checked_at: new Date().toISOString(),
    });
  };

  const buscarEnMeli = async () => {
    setBuscando(true);
    setError("");
    setSugerencia(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("meli-listings", {
        body: { action: "dimensions", product_id: productId },
      });
      if (err) throw new Error(await mensajeDe(err));
      if (data?.error) throw new Error(data.error);
      setSugerencia(data as Sugerencia);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscando(false);
    }
  };

  // Pasa la sugerencia al formulario: se revisa y se guarda a mano.
  const usarSugerencia = (s: Sugerencia) =>
    setForm({
      kg: s.weight_grams ? String(s.weight_grams / 1000).replace(".", ",") : form.kg,
      alto: s.height_cm ? String(s.height_cm) : form.alto,
      ancho: s.width_cm ? String(s.width_cm) : form.ancho,
      largo: s.length_cm ? String(s.length_cm) : form.largo,
      source: "meli",
      url: s.url ?? "",
    });

  const propias =
    datos.weight_grams && datos.height_cm && datos.width_cm && datos.length_cm
      ? {
          weight_grams: datos.weight_grams,
          height_cm: datos.height_cm,
          width_cm: datos.width_cm,
          length_cm: datos.length_cm,
        }
      : null;

  const icono = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );

  return (
    <section className="card p-5">
      <h2 className="text-sm font-medium">Envío: peso y medidas</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Del bulto listo para despachar, con caja. Todavía no se usa para cotizar.
      </p>

      {/* ------------------------------ Lo que hay ------------------------------ */}
      <div className="mt-4 rounded-lg bg-neutral-50 px-3 py-2.5">
        {propias ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-sm font-medium">{describirBulto(propias)}</span>
              {datos.dims_source && <Badge tone="green">{DIMS_SOURCE_LABEL[datos.dims_source]}</Badge>}
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="text-xs text-neutral-400">
                Cargado el {dateTime(datos.dims_checked_at)}
                {datos.dims_url && (
                  <>
                    {" · "}
                    <a href={datos.dims_url} target="_blank" rel="noopener" className="underline">
                      fuente
                    </a>
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => guardar(VACIO)}
                disabled={guardando}
                className="text-xs text-neutral-400 underline hover:text-neutral-700"
              >
                Borrar
              </button>
            </div>
          </>
        ) : perfil === undefined ? (
          <p className="text-xs text-neutral-400">Cargando…</p>
        ) : perfil ? (
          <p className="text-xs text-neutral-600">
            Usando el perfil <b>{perfil.name}</b> de la categoría:{" "}
            <span className="tabular">{describirBulto(perfil)}</span>
          </p>
        ) : (
          <p className="text-xs text-amber-700">
            Sin medidas propias y la categoría no tiene perfil.{" "}
            <Link to="/envios" className="underline">Asignar uno</Link>
          </p>
        )}
      </div>

      {/* -------------------------------- Fuentes -------------------------------- */}
      <div className="mt-4 grid gap-2">
        <a
          href={fichaOficialUrl(model, provider)}
          target="_blank"
          rel="noopener"
          onClick={() => set("source", "official")}
          className="btn inline-flex w-full items-center justify-center gap-2"
        >
          Buscar ficha oficial
          {icono}
        </a>
        <button
          type="button"
          onClick={buscarEnMeli}
          disabled={buscando}
          className="btn w-full disabled:opacity-50"
        >
          {buscando ? "Buscando en MercadoLibre…" : "Traer de MercadoLibre"}
        </button>
      </div>

      {sugerencia &&
        (sugerencia.found ? (
          <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-900">
            <p>
              <b>{sugerencia.origin}</b>
              {sugerencia.url && (
                <>
                  {" · "}
                  <a href={sugerencia.url} target="_blank" rel="noopener" className="underline">ver</a>
                </>
              )}
            </p>
            <p className="tabular mt-1">
              {sugerencia.height_cm ?? "?"}×{sugerencia.width_cm ?? "?"}×{sugerencia.length_cm ?? "?"} cm ·{" "}
              {sugerencia.weight_grams ? `${sugerencia.weight_grams / 1000} kg` : "? kg"}
            </p>
            {!sugerencia.package && (
              <p className="mt-1 text-amber-700">
                Son medidas del producto suelto, sin caja: sumale un margen antes de guardar.
              </p>
            )}
            <button type="button" onClick={() => usarSugerencia(sugerencia)} className="mt-2 underline">
              Pasar al formulario
            </button>
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            MercadoLibre no tiene medidas para este modelo.{" "}
            <a
              href={meliSearchUrl(model, provider)}
              target="_blank"
              rel="noopener"
              onClick={() => set("source", "meli")}
              className="underline"
            >
              Buscar en el listado
            </a>{" "}
            y cargarlas a mano.
          </p>
        ))}

      {/* ------------------------------ Formulario ------------------------------ */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(
          [
            ["kg", "Peso (kg)"],
            ["alto", "Alto (cm)"],
            ["ancho", "Ancho (cm)"],
            ["largo", "Largo (cm)"],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <label className="label">{label}</label>
            <input
              value={form[k]}
              onChange={(e) => set(k, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmar()}
              inputMode="decimal"
              className="input"
            />
          </div>
        ))}
        <div className="col-span-2">
          <label className="label">Origen</label>
          <select
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            className="input"
          >
            {(Object.keys(DIMS_SOURCE_LABEL) as DimsSource[]).map((s) => (
              <option key={s} value={s}>{DIMS_SOURCE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Link de la fuente</label>
          <input
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="opcional: el PDF o la página"
            className="input"
          />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        Con decimales está bien: se redondea para arriba a gramos y cm enteros.
      </p>

      <button
        type="button"
        onClick={confirmar}
        disabled={guardando}
        className="btn-primary mt-3 w-full disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Guardar medidas"}
      </button>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </section>
  );
};
