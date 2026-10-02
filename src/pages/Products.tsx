import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number } from "@/lib/format";
import { getComision, gananciaNeta } from "@/lib/comision";
import { PageTitle, Badge, Loading, ErrorBox } from "@/components/ui";
import type { Product } from "@/lib/types";

const PAGINA = 40;

// Las tres columnas de plata se pueden ordenar. La clave no es el nombre de la
// columna en la base sino cómo se saca el número de la fila, porque "ganancia
// neta" no existe en `products`: se calcula con la comisión del panel.
const ORDENABLES = {
  cost: (p: Product, _c: number) => p.cost,
  price: (p: Product, _c: number) => p.effective_price,
  ganancia: (p: Product, c: number) => gananciaNeta(p.cost, p.effective_price, c),
} as const;

type Columna = keyof typeof ORDENABLES;
type Orden = { columna: Columna; dir: "asc" | "desc" } | null;

// El orden viaja en la URL como "ganancia:desc". Se valida al leer porque la
// URL la escribe cualquiera: un parámetro raro tiene que caer en "sin orden",
// no romper la tabla.
const escribirOrden = (o: Orden) => (o ? `${o.columna}:${o.dir}` : null);

const leerOrden = (v: string | null): Orden => {
  if (!v) return null;

  const [columna, dir] = v.split(":");
  if (!(columna in ORDENABLES)) return null;
  if (dir !== "asc" && dir !== "desc") return null;

  return { columna: columna as Columna, dir };
};

/**
 * Encabezado que ordena. Tres estados por columna: primero de mayor a menor
 * —que es lo que se busca en una columna de plata—, después al revés, y el
 * tercer clic vuelve al orden por modelo.
 */
const ThOrden = ({
  columna,
  orden,
  onOrden,
  children,
}: {
  columna: Columna;
  orden: Orden;
  onOrden: (o: Orden) => void;
  children: React.ReactNode;
}) => {
  const activa = orden?.columna === columna;

  const siguiente = (): Orden =>
    !activa
      ? { columna, dir: "desc" }
      : orden!.dir === "desc"
      ? { columna, dir: "asc" }
      : null;

  return (
    <th className="th text-right">
      <button
        onClick={() => onOrden(siguiente())}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-neutral-900 ${
          activa ? "text-neutral-900" : ""
        }`}
      >
        {children}
        <span className={activa ? "" : "text-neutral-300"}>
          {activa ? (orden!.dir === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
  );
};

/**
 * "Para revisar": los casos que en la práctica hay que ir a buscar a mano. Cada
 * uno es una pregunta concreta sobre la fila, no un rango.
 */
const REVISAR = {
  "a-perdida": {
    label: "A pérdida",
    test: (p: Product, c: number) => {
      const g = gananciaNeta(p.cost, p.effective_price, c);
      return g != null && g <= 0;
    },
  },
  "sin-costo": { label: "Sin costo cargado", test: (p: Product) => p.cost == null },
  "sin-foto": { label: "Sin foto", test: (p: Product) => !p.thumbnail },
  manual: { label: "Precio fijado a mano", test: (p: Product) => p.price_override != null },
  "caro-meli": {
    label: "Más caro que en MELI",
    test: (p: Product) => p.meli_price != null && p.effective_price > p.meli_price,
  },
} as const;

type Revisar = keyof typeof REVISAR;

// Un número de la URL: vacío o basura es "sin límite", no cero.
const leerNumero = (v: string | null) => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const InputRango = ({
  valor,
  onCambiar,
  placeholder,
}: {
  valor: string;
  onCambiar: (v: string) => void;
  placeholder: string;
}) => (
  <input
    type="number"
    inputMode="numeric"
    value={valor}
    onChange={(e) => onCambiar(e.target.value)}
    placeholder={placeholder}
    aria-label={placeholder}
    className="w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-xs font-normal normal-case tracking-normal text-neutral-700 outline-none placeholder:text-neutral-400 focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
  />
);

/**
 * Mostrar u ocultar desde el listado, sin entrar al detalle. Escribe al toque:
 * es un solo campo, se ve el resultado en la fila y se deshace con otro clic.
 */
const SwitchVisible = ({
  activo,
  ocupado,
  onCambiar,
}: {
  activo: boolean;
  ocupado: boolean;
  onCambiar: (v: boolean) => void;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={activo}
    aria-label={activo ? "Ocultar de la tienda" : "Mostrar en la tienda"}
    title={activo ? "Visible en la tienda" : "Oculto"}
    disabled={ocupado}
    onClick={() => onCambiar(!activo)}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
      activo ? "bg-green-600" : "bg-neutral-300"
    }`}
  >
    <span
      className={`inline-block size-4 rounded-full bg-white shadow transition ${
        activo ? "translate-x-[18px]" : "translate-x-0.5"
      }`}
    />
  </button>
);

const Products = () => {
  const location = useLocation();
  const [productos, setProductos] = useState<Product[]>([]);
  const [cambiando, setCambiando] = useState<Record<string, boolean>>({});
  const [categorias, setCategorias] = useState<string[]>([]);
  // Los filtros viven en la URL y no en el estado. Así volver del detalle de un
  // producto con el botón atrás devuelve el listado como estaba —que antes se
  // perdía y había que filtrar de nuevo cada vez— y además una búsqueda que
  // usás seguido se puede guardar en favoritos o pasar por chat.
  const [params, setParams] = useSearchParams();

  const busqueda = params.get("q") ?? "";
  const categoria = params.get("cat") ?? "";
  const soloPromo = params.get("promo") === "1";
  const orden = leerOrden(params.get("orden"));
  // "1" solo visibles, "0" solo ocultos, sin parámetro todos.
  const visibilidad = params.get("vis");
  // Un rango por cada columna de plata, en la URL como "price-min=50000".
  // Mismas claves que el orden: el número que se filtra es el que se ordena y
  // el que se ve en la columna.
  const COLUMNAS = Object.keys(ORDENABLES) as Columna[];
  const rangos = COLUMNAS.map((columna) => ({
    columna,
    min: leerNumero(params.get(`${columna}-min`)),
    max: leerNumero(params.get(`${columna}-max`)),
  })).filter((r) => r.min != null || r.max != null);
  const claveRangos = rangos.map((r) => `${r.columna}:${r.min}:${r.max}`).join("|");
  const revisarParam = params.get("revisar");
  const revisar = revisarParam && revisarParam in REVISAR ? (revisarParam as Revisar) : null;

  // `replace` a propósito: filtrar no es navegar. Sin esto, escribir "ezviz"
  // deja cinco entradas en el historial y el botón atrás deja de servir para
  // lo único que importa, que es volver al listado.
  // Se actualiza a partir del valor anterior y no del `params` capturado en el
  // render: escribiendo rápido, dos teclas seguidas leerían el mismo estado
  // viejo y la segunda pisaría a la primera.
  const setParam = (clave: string, valor: string | null) => {
    setParams(
      (anterior) => {
        const siguiente = new URLSearchParams(anterior);
        if (valor) siguiente.set(clave, valor);
        else siguiente.delete(clave);
        return siguiente;
      },
      { replace: true }
    );
  };

  const setBusqueda = (v: string) => setParam("q", v);
  const setCategoria = (v: string) => setParam("cat", v);
  const setSoloPromo = (v: boolean) => setParam("promo", v ? "1" : null);
  const setOrden = (o: Orden) => setParam("orden", escribirOrden(o));

  // Las claves que son filtro (no el orden): para saber si hay alguno puesto y
  // poder sacarlos todos de una.
  const FILTROS = [
    "q", "cat", "promo", "vis", "revisar",
    ...COLUMNAS.flatMap((c) => [`${c}-min`, `${c}-max`]),
  ];
  const hayFiltros = FILTROS.some((k) => params.has(k));
  const limpiarFiltros = () =>
    setParams(
      (anterior) => {
        const siguiente = new URLSearchParams(anterior);
        FILTROS.forEach((k) => siguiente.delete(k));
        return siguiente;
      },
      { replace: true }
    );
  const [visibles, setVisibles] = useState(PAGINA);
  const [comision] = useState(getComision);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [p, c] = await Promise.all([
        supabase
          .from("products")
          .select("id,model,title,provider,category,thumbnail,cost,margin_pct,price_override,price,effective_price,discount,has_promotion,is_active,meli_price")
          .order("model"),
        supabase.from("categories").select("name").order("name"),
      ]);

      if (p.error ?? c.error) setError((p.error ?? c.error)!.message);

      setProductos((p.data ?? []) as Product[]);
      setCategorias((c.data ?? []).map((x) => x.name));
      setCargando(false);
    })();
  }, []);

  // Filtrado en memoria: son ~700 productos, traerlos una vez y buscar acá es
  // instantáneo y evita un round-trip por tecla.
  const filtrados = useMemo(() => {
    const terminos = busqueda.toLowerCase().split(/\s+/).filter(Boolean);

    return productos.filter((p) => {
      if (categoria && p.category !== categoria) return false;
      // Lo mismo que muestra la tienda en el carrusel de destacados y en
      // /category/promociones: has_promotion + is_active.
      if (soloPromo && !(p.has_promotion && p.is_active)) return false;
      if (visibilidad === "1" && !p.is_active) return false;
      if (visibilidad === "0" && p.is_active) return false;
      // Con un rango puesto, una fila sin el dato (sin costo, por ejemplo) no
      // entra: no se sabe si cumple. Para encontrarlas está "Sin costo cargado".
      for (const r of rangos) {
        const v = ORDENABLES[r.columna](p, comision);
        if (v == null) return false;
        if (r.min != null && v < r.min) return false;
        if (r.max != null && v > r.max) return false;
      }
      if (revisar && !REVISAR[revisar].test(p, comision)) return false;
      if (terminos.length === 0) return true;

      const texto = `${p.model} ${p.title} ${p.provider ?? ""}`.toLowerCase();
      return terminos.every((t) => texto.includes(t));
    });
  }, [productos, busqueda, categoria, soloPromo, visibilidad, claveRangos, revisar, comision]);

  // El orden se aplica sobre lo filtrado, así que ordenar y filtrar se
  // combinan: "las 40 de mayor ganancia dentro de Kits" es dos clics.
  //
  // Los nulos van siempre al final, en cualquiera de las dos direcciones. Un
  // producto sin costo cargado no es "el más barato": es uno que no sabemos
  // cuánto cuesta, y arriba de todo solo tapa lo que se está buscando.
  const ordenados = useMemo(() => {
    if (!orden) return filtrados;

    const valor = ORDENABLES[orden.columna];
    const signo = orden.dir === "desc" ? -1 : 1;

    return [...filtrados].sort((a, b) => {
      const va = valor(a, comision);
      const vb = valor(b, comision);

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      return (va - vb) * signo;
    });
  }, [filtrados, orden, comision]);

  useEffect(
    () => setVisibles(PAGINA),
    [busqueda, categoria, soloPromo, visibilidad, claveRangos, revisar]
  );

  // Optimista: la fila cambia ya y, si la base lo rechaza, vuelve atrás.
  const cambiarVisible = async (id: string, visible: boolean) => {
    const poner = (v: boolean) =>
      setProductos((ps) => ps.map((p) => (p.id === id ? { ...p, is_active: v } : p)));

    setError("");
    setCambiando((c) => ({ ...c, [id]: true }));
    poner(visible);

    const { error: e } = await supabase
      .from("products")
      .update({ is_active: visible })
      .eq("id", id);

    if (e) {
      poner(!visible);
      setError(e.message);
    }
    setCambiando((c) => ({ ...c, [id]: false }));
  };

  if (cargando) return <Loading />;

  return (
    <>
      <PageTitle
        action={
          <span className="text-sm text-neutral-500">
            {number(ordenados.length)}
            {ordenados.length !== productos.length && ` de ${number(productos.length)}`}
          </span>
        }
      >
        Productos
      </PageTitle>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          autoFocus
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por modelo, título o marca…"
          className="input max-w-xs"
        />
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="input w-auto"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={revisar ?? ""}
          onChange={(e) => setParam("revisar", e.target.value || null)}
          className="input w-auto"
        >
          <option value="">Para revisar…</option>
          {(Object.keys(REVISAR) as Revisar[]).map((k) => (
            <option key={k} value={k}>{REVISAR[k].label}</option>
          ))}
        </select>
        <label
          className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600"
          title="Lo que aparece en el carrusel de destacados y en /category/promociones"
        >
          <input
            type="checkbox"
            checked={soloPromo}
            onChange={(e) => setSoloPromo(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-primary focus:ring-primary/20"
          />
          Solo en promoción
        </label>

        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="text-sm text-neutral-500 transition hover:text-neutral-900"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* La tabla se dibuja siempre, aunque no haya resultados: los filtros de
          columna viven en el encabezado, y si desaparece con la tabla no hay
          forma de corregir el número que dejó la lista vacía. */}
      <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th w-12"></th>
                <th className="th">Modelo</th>
                <th className="th">Categoría</th>
                <ThOrden columna="cost" orden={orden} onOrden={setOrden}>
                  Costo
                </ThOrden>
                <ThOrden columna="price" orden={orden} onOrden={setOrden}>
                  Precio
                </ThOrden>
                <ThOrden columna="ganancia" orden={orden} onOrden={setOrden}>
                  Ganancia neta
                </ThOrden>
                <th className="th">Visible</th>
                <th className="th"></th>
              </tr>
              {/* Rango por columna. Solo mínimo es "mayor a", solo máximo es
                  "menor a", los dos es un rango. */}
              <tr>
                <th className="px-4 pb-2.5" colSpan={3} />
                {COLUMNAS.map((c) => (
                  <th key={c} className="px-4 pb-2.5">
                    <div className="ml-auto flex w-36 items-center gap-1">
                      <InputRango
                        valor={params.get(`${c}-min`) ?? ""}
                        onCambiar={(v) => setParam(`${c}-min`, v || null)}
                        placeholder="mín"
                      />
                      <InputRango
                        valor={params.get(`${c}-max`) ?? ""}
                        onCambiar={(v) => setParam(`${c}-max`, v || null)}
                        placeholder="máx"
                      />
                    </div>
                  </th>
                ))}
                <th className="px-4 pb-2.5">
                  <select
                    value={visibilidad ?? ""}
                    onChange={(e) => setParam("vis", e.target.value || null)}
                    aria-label="Filtrar por visibilidad"
                    className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs font-normal normal-case tracking-normal text-neutral-700 outline-none focus:border-primary"
                  >
                    <option value="">Todos</option>
                    <option value="1">Visibles</option>
                    <option value="0">Ocultos</option>
                  </select>
                </th>
                <th className="px-4 pb-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {ordenados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-sm text-neutral-500">
                    No hay productos que coincidan.
                  </td>
                </tr>
              )}
              {ordenados.slice(0, visibles).map((p) => {
                const ganancia = gananciaNeta(p.cost, p.effective_price, comision);

                return (
                  <tr
                    key={p.id}
                    className={`transition hover:bg-neutral-50 ${
                      p.is_active ? "" : "bg-neutral-50/60 opacity-60"
                    }`}
                  >
                    <td className="td">
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="size-8 rounded object-cover" />
                      ) : (
                        <div className="size-8 rounded bg-neutral-100" title="Sin foto" />
                      )}
                    </td>
                    <td className="td">
                      {/* El listado tal como está (búsqueda, filtros, orden) viaja
                          al detalle para que "← Productos" vuelva acá y no al
                          listado pelado. */}
                      <Link
                        to={`/productos/${p.id}`}
                        state={{ volver: `/productos${location.search}` }}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {p.model}
                      </Link>
                      <p className="text-xs text-neutral-400">{p.provider}</p>
                    </td>
                    <td className="td text-neutral-500">{p.category}</td>
                    <td className="td tabular text-right text-neutral-500">{money(p.cost)}</td>
                    <td className="td tabular text-right font-medium">
                      {money(p.effective_price)}
                      {p.price_override != null && (
                        <span className="ml-1.5 align-middle"><Badge tone="violet">manual</Badge></span>
                      )}
                    </td>
                    <td className="td text-right">
                      {ganancia == null ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        // Verde solo si de verdad se gana: un tag verde sobre
                        // una venta a pérdida es peor que no mostrar nada.
                        <span className="tabular">
                          <Badge tone={ganancia <= 0 ? "red" : "green"}>{money(ganancia)}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <SwitchVisible
                        activo={p.is_active}
                        ocupado={Boolean(cambiando[p.id])}
                        onCambiar={(v) => cambiarVisible(p.id, v)}
                      />
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        {p.has_promotion &&
                          (p.discount >= 1 && p.discount <= 50 ? (
                            <Badge tone="amber">-{p.discount}%</Badge>
                          ) : (
                            <span title="El descuento se ignora fuera de 1–50: aparece en el carrusel pero sin rebaja">
                              <Badge tone="red">promo sin descuento</Badge>
                            </span>
                          ))}
                        {p.meli_price != null && (
                          <span title="Referencia de MercadoLibre. Se actualiza desde el detalle del producto.">
                            <Badge tone="amber">MELI {money(p.meli_price)}</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visibles < ordenados.length && (
            <div className="border-t border-neutral-100 p-3 text-center">
              <button onClick={() => setVisibles((v) => v + PAGINA)} className="btn-ghost">
                Ver más ({number(ordenados.length - visibles)} restantes)
              </button>
            </div>
          )}
      </div>
    </>
  );
};

export default Products;
