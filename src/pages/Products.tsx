import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number } from "@/lib/format";
import { getComision, gananciaNeta } from "@/lib/comision";
import { PageTitle, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
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

const Products = () => {
  const [productos, setProductos] = useState<Product[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soloPromo, setSoloPromo] = useState(false);
  const [orden, setOrden] = useState<Orden>(null);
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
      if (terminos.length === 0) return true;

      const texto = `${p.model} ${p.title} ${p.provider ?? ""}`.toLowerCase();
      return terminos.every((t) => texto.includes(t));
    });
  }, [productos, busqueda, categoria, soloPromo]);

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

  useEffect(() => setVisibles(PAGINA), [busqueda, categoria, soloPromo]);

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
          className="input max-w-[11rem]"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>{c}</option>
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
      </div>

      {ordenados.length === 0 ? (
        <Empty>No hay productos que coincidan.</Empty>
      ) : (
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
            </thead>
            <tbody className="divide-y divide-neutral-100">
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
                      <Link to={`/productos/${p.id}`} className="font-medium text-neutral-900 hover:underline">
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
                      {p.is_active ? (
                        <Badge tone="green">visible</Badge>
                      ) : (
                        <Badge tone="neutral">oculto</Badge>
                      )}
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
      )}
    </>
  );
};

export default Products;
