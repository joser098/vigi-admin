import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number } from "@/lib/format";
import { getComision, gananciaNeta } from "@/lib/comision";
import { PageTitle, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import type { Product } from "@/lib/types";

const PAGINA = 40;

const Products = () => {
  const [productos, setProductos] = useState<Product[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soloSinFoto, setSoloSinFoto] = useState(false);
  const [soloPromo, setSoloPromo] = useState(false);
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
      if (soloSinFoto && p.thumbnail) return false;
      // Lo mismo que muestra la tienda en el carrusel de destacados y en
      // /category/promociones: has_promotion + is_active.
      if (soloPromo && !(p.has_promotion && p.is_active)) return false;
      if (terminos.length === 0) return true;

      const texto = `${p.model} ${p.title} ${p.provider ?? ""}`.toLowerCase();
      return terminos.every((t) => texto.includes(t));
    });
  }, [productos, busqueda, categoria, soloSinFoto, soloPromo]);

  useEffect(() => setVisibles(PAGINA), [busqueda, categoria, soloSinFoto, soloPromo]);

  if (cargando) return <Loading />;

  return (
    <>
      <PageTitle
        action={
          <span className="text-sm text-neutral-500">
            {number(filtrados.length)}
            {filtrados.length !== productos.length && ` de ${number(productos.length)}`}
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
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={soloSinFoto}
            onChange={(e) => setSoloSinFoto(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-primary focus:ring-primary/20"
          />
          Solo sin foto
        </label>
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

      {filtrados.length === 0 ? (
        <Empty>No hay productos que coincidan.</Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th w-12"></th>
                <th className="th">Modelo</th>
                <th className="th">Categoría</th>
                <th className="th text-right">Costo</th>
                <th className="th text-right">Precio</th>
                <th className="th text-right">Ganancia neta</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtrados.slice(0, visibles).map((p) => {
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
                        {!p.is_active && <Badge tone="red">inactivo</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visibles < filtrados.length && (
            <div className="border-t border-neutral-100 p-3 text-center">
              <button onClick={() => setVisibles((v) => v + PAGINA)} className="btn-ghost">
                Ver más ({number(filtrados.length - visibles)} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default Products;
