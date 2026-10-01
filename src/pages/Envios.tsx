import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { aCmEntero, describirBulto, kgAGramos, leerNumero, DIMS_SOURCE_LABEL } from "@/lib/envio";
import type { DimsSource, ShippingProfile } from "@/lib/types";
import { Badge, ErrorBox, Loading, PageTitle, Stat } from "@/components/ui";

/**
 * Perfiles de caja y a qué categoría va cada uno (migración 0023).
 *
 * Es la primera aproximación del peso y las medidas de envío: unas pocas cajas
 * típicas medidas una vez, y cada categoría apunta a una. Lo que se carga en
 * el detalle de un producto manda sobre esto.
 *
 * Todavía no lo usa ninguna cotización.
 */

type Categoria = { name: string; label: string; shipping_profile_id: string | null };
type FilaProducto = { category: string; weight_grams: number | null; dims_source: DimsSource | null };

type Borrador = { id: string | null; name: string; kg: string; alto: string; ancho: string; largo: string; notes: string };

const aBorrador = (p: ShippingProfile): Borrador => ({
  id: p.id,
  name: p.name,
  kg: String(p.weight_grams / 1000).replace(".", ","),
  alto: String(p.height_cm),
  ancho: String(p.width_cm),
  largo: String(p.length_cm),
  notes: p.notes ?? "",
});

const NUEVO: Borrador = { id: null, name: "", kg: "", alto: "", ancho: "", largo: "", notes: "" };

const Envios = () => {
  const [perfiles, setPerfiles] = useState<ShippingProfile[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<FilaProducto[]>([]);
  const [editando, setEditando] = useState<Borrador | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = async () => {
    const [p, c, pr] = await Promise.all([
      supabase.from("shipping_profiles").select("*").order("weight_grams"),
      supabase.from("categories").select("name, label, shipping_profile_id").order("label"),
      supabase
        .from("products")
        .select("category, weight_grams, dims_source")
        .eq("is_active", true)
        .range(0, 4999),
    ]);
    const err = p.error ?? c.error ?? pr.error;
    if (err) setError(err.message);
    setPerfiles((p.data ?? []) as ShippingProfile[]);
    setCategorias((c.data ?? []) as Categoria[]);
    setProductos((pr.data ?? []) as FilaProducto[]);
    setCargando(false);
  };

  useEffect(() => {
    cargar();
  }, []);

  const guardarPerfil = async () => {
    if (!editando) return;
    const kg = leerNumero(editando.kg);
    const alto = leerNumero(editando.alto);
    const ancho = leerNumero(editando.ancho);
    const largo = leerNumero(editando.largo);
    if (!editando.name.trim() || !kg || !alto || !ancho || !largo) {
      setError("El perfil necesita nombre, peso, alto, ancho y largo.");
      return;
    }
    if (kg > 100) {
      setError("El peso va en kg: ¿no lo escribiste en gramos?");
      return;
    }

    setGuardando(true);
    setError("");
    const fila = {
      name: editando.name.trim(),
      weight_grams: kgAGramos(kg),
      height_cm: aCmEntero(alto),
      width_cm: aCmEntero(ancho),
      length_cm: aCmEntero(largo),
      notes: editando.notes.trim() || null,
    };
    const { error: e } = editando.id
      ? await supabase.from("shipping_profiles").update(fila).eq("id", editando.id)
      : await supabase.from("shipping_profiles").insert(fila);
    if (e) setError(e.message);
    else {
      setEditando(null);
      await cargar();
    }
    setGuardando(false);
  };

  const borrarPerfil = async (p: ShippingProfile) => {
    // Sin confirm(): las categorías que lo usaban quedan sin perfil
    // (on delete set null), y se ve enseguida en la tabla de abajo.
    setError("");
    const { error: e } = await supabase.from("shipping_profiles").delete().eq("id", p.id);
    if (e) setError(e.message);
    await cargar();
  };

  const asignar = async (categoria: string, profileId: string | null) => {
    setError("");
    setCategorias((cs) => cs.map((c) => (c.name === categoria ? { ...c, shipping_profile_id: profileId } : c)));
    const { error: e } = await supabase
      .from("categories")
      .update({ shipping_profile_id: profileId })
      .eq("name", categoria);
    if (e) {
      setError(e.message);
      await cargar();
    }
  };

  if (cargando) return <Loading />;

  // Cobertura: de dónde sale el bulto de cada producto activo.
  const conPerfil = new Set(categorias.filter((c) => c.shipping_profile_id).map((c) => c.name));
  const propios = productos.filter((p) => p.weight_grams != null);
  const porPerfil = productos.filter((p) => p.weight_grams == null && conPerfil.has(p.category));
  const sinDato = productos.length - propios.length - porPerfil.length;
  const porFuente = (s: DimsSource) => propios.filter((p) => p.dims_source === s).length;

  const productosDe = (cat: string) => productos.filter((p) => p.category === cat);

  const campo = (k: keyof Borrador, placeholder: string, ancho = "w-20") => (
    <input
      value={editando?.[k] ?? ""}
      onChange={(e) => setEditando((b) => (b ? { ...b, [k]: e.target.value } : b))}
      onKeyDown={(e) => e.key === "Enter" && guardarPerfil()}
      placeholder={placeholder}
      inputMode={k === "name" || k === "notes" ? undefined : "decimal"}
      className={`input ${ancho}`}
    />
  );

  return (
    <>
      <PageTitle>Envíos</PageTitle>
      <p className="-mt-4 mb-6 max-w-2xl text-sm text-neutral-500">
        Peso y medidas del bulto de cada producto. Primero se usa el perfil de caja de su categoría; si el
        producto tiene medidas propias (cargadas en su detalle), mandan esas. <b>Todavía no se usa para
        cotizar</b>: Andreani sigue con su bulto fijo.
      </p>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      {/* ------------------------------ Cobertura ------------------------------ */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Medidas propias"
          value={propios.length}
          hint={(Object.keys(DIMS_SOURCE_LABEL) as DimsSource[])
            .map((s) => `${DIMS_SOURCE_LABEL[s]}: ${porFuente(s)}`)
            .join(" · ")}
        />
        <Stat label="Por perfil de categoría" value={porPerfil.length} />
        <Stat
          label="Sin dato"
          value={<span className={sinDato > 0 ? "text-amber-600" : ""}>{sinDato}</span>}
          hint="Su categoría no tiene perfil"
        />
      </div>

      {/* ------------------------------- Perfiles ------------------------------- */}
      <section className="card mb-6 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-sm font-medium">Perfiles de caja</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Medí y pesá una caja real de cada tipo, ya armada para despachar.
            </p>
          </div>
          {!editando && (
            <button onClick={() => setEditando(NUEVO)} className="btn-ghost shrink-0">
              Nuevo perfil
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Nombre</th>
                <th className="th">Bulto</th>
                <th className="th">Notas</th>
                <th className="th text-right">Categorías</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {perfiles.map((p) =>
                editando?.id === p.id ? null : (
                  <tr key={p.id}>
                    <td className="td font-medium">{p.name}</td>
                    <td className="td tabular whitespace-nowrap">{describirBulto(p)}</td>
                    <td className="td text-neutral-500">{p.notes ?? "—"}</td>
                    <td className="td tabular text-right">
                      {categorias.filter((c) => c.shipping_profile_id === p.id).length}
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <button onClick={() => setEditando(aBorrador(p))} className="text-xs underline">
                        Editar
                      </button>
                      <button
                        onClick={() => borrarPerfil(p)}
                        className="ml-3 text-xs text-neutral-400 underline hover:text-red-600"
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                )
              )}

              {editando && (
                <tr className="bg-neutral-50">
                  <td className="td">{campo("name", "Kit grande", "w-36")}</td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {campo("alto", "alto")}×{campo("ancho", "ancho")}×{campo("largo", "largo")}
                      <span className="text-xs text-neutral-400">cm</span>
                      {campo("kg", "peso")}
                      <span className="text-xs text-neutral-400">kg</span>
                    </div>
                  </td>
                  <td className="td">{campo("notes", "para qué sirve", "w-44")}</td>
                  <td className="td" />
                  <td className="td whitespace-nowrap text-right">
                    <button onClick={guardarPerfil} disabled={guardando} className="btn-primary">
                      {guardando ? "…" : "Guardar"}
                    </button>
                    <button onClick={() => setEditando(null)} className="ml-2 text-xs underline">
                      Cancelar
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------ Categorías ------------------------------ */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="text-sm font-medium">Perfil por categoría</h2>
          <p className="mt-1 text-xs text-neutral-500">Se guarda al elegirlo.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Categoría</th>
                <th className="th text-right">Productos activos</th>
                <th className="th text-right">Con medidas propias</th>
                <th className="th">Perfil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {categorias.map((c) => {
                const ps = productosDe(c.name);
                return (
                  <tr key={c.name}>
                    <td className="td">
                      {c.label}
                      {!c.shipping_profile_id && ps.length > 0 && (
                        <span className="ml-2"><Badge tone="amber">sin perfil</Badge></span>
                      )}
                    </td>
                    <td className="td tabular text-right">{ps.length}</td>
                    <td className="td tabular text-right">{ps.filter((p) => p.weight_grams != null).length}</td>
                    <td className="td">
                      <select
                        value={c.shipping_profile_id ?? ""}
                        onChange={(e) => asignar(c.name, e.target.value || null)}
                        className="input max-w-56"
                      >
                        <option value="">Sin perfil</option>
                        {perfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

export default Envios;
