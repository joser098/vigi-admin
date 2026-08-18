import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, dateTime } from "@/lib/format";
import { getComision, setComision, comisionMonto, gananciaNeta, margenNeto } from "@/lib/comision";
import { galleryUrl, guardarGaleria, type ItemGaleria } from "@/lib/images";
import { Badge, Loading, ErrorBox, Empty } from "@/components/ui";
import GalleryEditor from "@/components/GalleryEditor";
import { MeliPrice } from "../components/MeliPrice";
import type { Product } from "@/lib/types";

// Lo que el panel puede escribir. Coincide con los GRANT de la base: cost,
// price y model no están, y aunque se intentara, Postgres lo rechaza.
type Editable = Pick<
  Product,
  "title" | "description" | "provider" | "category" | "location" | "power_type" |
  "is_analogue" | "tags" | "margin_pct" | "price_override" | "discount" |
  "has_promotion" | "is_active"
>;

const Campo = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div>
    <label className="label">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
  </div>
);

const Seccion = ({ titulo, desc, children, className = "" }: {
  titulo: string; desc?: string; children: React.ReactNode; className?: string;
}) => (
  <section className={`card p-5 ${className}`}>
    <h2 className="text-sm font-medium">{titulo}</h2>
    {desc && <p className="mt-1 text-xs text-neutral-500">{desc}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const ProductDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [producto, setProducto] = useState<Product | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [galeria, setGaleria] = useState<ItemGaleria[]>([]);
  const [galeriaTocada, setGaleriaTocada] = useState(false);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [comision, setComisionState] = useState(getComision);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [guardado, setGuardado] = useState(false);
  const [sucio, setSucio] = useState(false);

  const cargar = async () => {
    const [p, c, m] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).maybeSingle(),
      supabase.from("categories").select("name").order("name"),
      supabase.from("products").select("provider").not("provider", "is", null),
    ]);

    if (p.error) setError(p.error.message);

    if (p.data) {
      const prod = p.data as Product;
      setProducto(prod);
      setForm({
        title: prod.title,
        description: prod.description,
        provider: prod.provider,
        category: prod.category,
        location: prod.location,
        power_type: prod.power_type,
        is_analogue: prod.is_analogue,
        tags: prod.tags ?? [],
        margin_pct: prod.margin_pct,
        price_override: prod.price_override,
        discount: prod.discount,
        has_promotion: prod.has_promotion,
        is_active: prod.is_active,
      });

      setGaleria(
        Array.from({ length: prod.gallery ?? 0 }, (_, i) => ({
          id: `existente-${i}`,
          tipo: "existente" as const,
          indice: i,
          preview: galleryUrl(prod.model, i),
        }))
      );
    }

    setCategorias((c.data ?? []).map((x) => x.name));
    setMarcas([...new Set((m.data ?? []).map((x) => x.provider as string))].sort());
    setGaleriaTocada(false);
    setSucio(false);
    setCargando(false);
  };

  useEffect(() => { cargar(); }, [id]);

  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setGuardado(false);
    setSucio(true);
  };

  const cambiarGaleria = (items: ItemGaleria[]) => {
    setGaleria(items);
    setGaleriaTocada(true);
    setGuardado(false);
    setSucio(true);
  };

  // Nada se guarda solo: todo espera al botón.
  const guardar = async () => {
    if (!form || !producto) return;
    setGuardando(true);
    setError("");

    try {
      // Las imágenes primero: si fallan, no queremos haber guardado el resto y
      // dejar la ficha diciendo que tiene fotos que no existen.
      if (galeriaTocada) await guardarGaleria(producto.model, galeria);

      const { error } = await supabase.from("products").update(form).eq("id", id);
      if (error) throw new Error(error.message);

      setGuardado(true);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <Loading />;
  if (!producto || !form) return <Empty>No se encontró el producto.</Empty>;

  // Vista previa de lo que va a quedar, con la misma fórmula que el trigger.
  const precioCalculado =
    form.price_override != null
      ? Number(form.price_override)
      : producto.cost != null
      ? Math.round(producto.cost * (1 + Number(form.margin_pct) / 100))
      : null;

  const conDescuento =
    precioCalculado != null && form.has_promotion && form.discount >= 1 && form.discount <= 50
      ? Math.floor(precioCalculado - (precioCalculado * form.discount) / 100)
      : precioCalculado;

  const comisionDelPrecio = comisionMonto(conDescuento, comision);
  const ganancia = gananciaNeta(producto.cost, conDescuento, comision);
  const margen = margenNeto(producto.cost, conDescuento, comision);

  return (
    <>
      <Link to="/productos" className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-900">
        ← Productos
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{producto.model}</h1>
            {!form.is_active && <Badge tone="red">oculto</Badge>}
            {form.has_promotion && <Badge tone="amber">promo</Badge>}
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {form.provider ?? "sin marca"} · {form.category}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {guardado && <span className="text-xs text-green-600">Guardado</span>}
          {sucio && !guardado && <span className="text-xs text-amber-600">Sin guardar</span>}
          <button onClick={guardar} disabled={guardando || !sucio} className="btn-primary">
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------------------------- Rentabilidad ---------------------------- */}
        <Seccion
          titulo="Rentabilidad"
          desc="El costo lo escribe el importador desde la lista del proveedor y no se edita acá."
          className="lg:col-span-2"
        >
          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <p className="label">Costo</p>
              <p className="tabular text-lg font-semibold">{money(producto.cost)}</p>
            </div>
            <div>
              <p className="label">Precio final</p>
              <p className="tabular text-lg font-semibold text-primary">{money(conDescuento)}</p>
            </div>
            <div>
              <p className="label">Comisión {comision}%</p>
              <p className="tabular text-lg font-semibold text-neutral-400">
                {comisionDelPrecio == null ? "—" : `− ${money(comisionDelPrecio)}`}
              </p>
            </div>
            <div>
              <p className="label">Ganancia neta</p>
              <p className={`tabular text-lg font-semibold ${ganancia != null && ganancia <= 0 ? "text-red-600" : ""}`}>
                {money(ganancia)}
              </p>
            </div>
            <div>
              <p className="label">Margen neto</p>
              <p className={`tabular text-lg font-semibold ${margen != null && margen < 10 ? "text-red-600" : ""}`}>
                {margen == null ? "—" : `${margen}%`}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              label="Margen (%)"
              hint={form.price_override != null ? "Ignorado: hay un precio manual" : "Referencia: 30%"}
            >
              <input
                type="number" min={0} step={1}
                value={form.margin_pct}
                onChange={(e) => set("margin_pct", Number(e.target.value))}
                disabled={form.price_override != null}
                className="input disabled:bg-neutral-50 disabled:text-neutral-400"
              />
            </Campo>

            <Campo label="Precio manual" hint="Fija el precio y lo protege de las actualizaciones de costo.">
              <div className="flex gap-2">
                <input
                  type="number" min={0} step={1}
                  value={form.price_override ?? ""}
                  onChange={(e) => set("price_override", e.target.value === "" ? null : Number(e.target.value))}
                  placeholder="usar el margen"
                  className="input"
                />
                {form.price_override != null && (
                  <button onClick={() => set("price_override", null)} className="btn-ghost shrink-0">
                    Quitar
                  </button>
                )}
              </div>
            </Campo>

            <Campo label="Comisión pasarela (%)" hint="No se guarda en el producto: es del medio de pago.">
              <input
                type="number" min={0} max={100} step={0.1}
                value={comision}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setComisionState(v);
                  setComision(v);
                }}
                className="input"
              />
            </Campo>
          </div>
        </Seccion>

        {/* --------------------------- Precio en MELI --------------------------- */}
        <MeliPrice
          productId={producto.id}
          nuestroPrecio={conDescuento}
          inicial={{
            meli_price: producto.meli_price,
            meli_url: producto.meli_url,
            meli_title: producto.meli_title,
            meli_checked_at: producto.meli_checked_at,
          }}
        />

        {/* ------------------------------ Imágenes ------------------------------ */}
        <Seccion titulo="Imágenes" desc="La primera es la que se ve en los listados.">
          <GalleryEditor items={galeria} onChange={cambiarGaleria} />
        </Seccion>

        {/* -------------------------------- Ficha -------------------------------- */}
        <Seccion titulo="Ficha" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Título">
              <input value={form.title} onChange={(e) => set("title", e.target.value)} className="input" />
            </Campo>

            <Campo label="Marca">
              <input
                list="marcas"
                value={form.provider ?? ""}
                onChange={(e) => set("provider", e.target.value || null)}
                className="input"
              />
              <datalist id="marcas">
                {marcas.map((m) => <option key={m} value={m} />)}
              </datalist>
            </Campo>

            <Campo label="Categoría">
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="input"
              >
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Campo>

            <Campo label="Ubicación" hint="Filtro de navegación en la tienda.">
              <select
                value={form.location ?? ""}
                onChange={(e) => set("location", (e.target.value || null) as Editable["location"])}
                className="input"
              >
                <option value="">Sin definir</option>
                <option value="interior">Interior</option>
                <option value="exterior">Exterior</option>
              </select>
            </Campo>

            <Campo label="Alimentación" hint="En minúscula y sin acento: el filtro compara exacto.">
              <input
                value={form.power_type ?? ""}
                onChange={(e) => set("power_type", e.target.value.toLowerCase() || null)}
                placeholder="bateria, cableada…"
                className="input"
              />
            </Campo>

            <Campo label="Etiquetas" hint="Separadas por coma. Se usan en la búsqueda.">
              <input
                value={(form.tags ?? []).join(", ")}
                onChange={(e) =>
                  set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))
                }
                className="input"
              />
            </Campo>

            <div className="sm:col-span-2">
              <Campo label="Descripción">
                <textarea
                  value={form.description ?? ""}
                  onChange={(e) => set("description", e.target.value || null)}
                  rows={3}
                  className="input resize-none"
                />
              </Campo>
            </div>
          </div>
        </Seccion>

        {/* ---------------------------- Visibilidad ---------------------------- */}
        <div className="space-y-6">
          <Seccion titulo="Promoción y visibilidad">
            <Campo label="Descuento (%)" hint="Solo se aplica entre 1 y 50. Fuera de ese rango se ignora.">
              <input
                type="number" min={0} max={100} step={1}
                value={form.discount}
                onChange={(e) => set("discount", Number(e.target.value))}
                className="input"
              />
            </Campo>

            <div className="mt-4 space-y-3">
              {[
                ["has_promotion", "En promoción"],
                ["is_active", "Visible en la tienda"],
                ["is_analogue", "Analógica (BNC)"],
              ].map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(form[k as keyof Editable])}
                    onChange={(e) => set(k as keyof Editable, e.target.checked as never)}
                    className="size-4 rounded border-neutral-300 text-primary focus:ring-primary/20"
                  />
                  {label}
                </label>
              ))}
            </div>
          </Seccion>

          <Seccion titulo="Datos">
            <dl className="space-y-2 text-xs">
              {[
                ["Modelo", producto.model],
                ["Actualizado", dateTime(producto.updated_at)],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-3">
                  <dt className="text-neutral-400">{k}</dt>
                  <dd className="text-right text-neutral-600">{v || "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
              El modelo no se edita: es la ruta de las imágenes y la URL del
              producto en la tienda.
            </p>
          </Seccion>
        </div>
      </div>
    </>
  );
};

export default ProductDetail;
