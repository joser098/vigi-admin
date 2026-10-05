import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number } from "@/lib/format";
import { PageTitle, Badge, Loading, ErrorBox, Stat } from "@/components/ui";
import {
  CONFIG_DEFECTO,
  descuentoMaximo,
  getConfig,
  precioNivel,
  precioPiso,
  setConfig,
  type ConfigReventa,
  type Nivel,
} from "@/lib/reventa";
import type { Product } from "@/lib/types";

const PAGINA = 40;

type Fila = Pick<
  Product,
  "id" | "model" | "title" | "provider" | "category" | "thumbnail" | "cost" | "effective_price" | "is_active"
>;

// Un producto sin costo no tiene precio de reventa: no se sabe si se gana.
type ConCosto = Fila & { cost: number };
const tieneCosto = (p: Fila): p is ConCosto => p.cost != null && p.cost > 0;

const pct = (n: number) => `${Math.round(n).toLocaleString("es-AR")}%`;

/**
 * Los casos para ir a mirar. "Topeado" es donde el descuento anunciado no se
 * puede dar entero; "público bajo el piso" es un problema del precio de la
 * tienda, no de la reventa, pero acá es donde salta.
 */
const REVISAR = {
  topeado: {
    label: "Topeados al piso en algún nivel",
    test: (p: ConCosto, c: ConfigReventa) =>
      c.niveles.some((n) => precioNivel(p.cost, p.effective_price, n.descuento, c.piso).topeado),
  },
  "bajo-piso": {
    label: "Precio público bajo el piso",
    test: (p: ConCosto, c: ConfigReventa) => p.effective_price < precioPiso(p.cost, c.piso),
  },
} as const;

type Revisar = keyof typeof REVISAR;

const ORDENES = {
  modelo: "Modelo",
  "desc-asc": "Menos margen para descontar",
  "desc-desc": "Más margen para descontar",
} as const;

type OrdenId = keyof typeof ORDENES;

// Un número escrito a mano: vacío o basura no pisa el valor anterior con 0.
const InputNumero = ({
  valor,
  onCambiar,
  sufijo,
  prefijo,
  ancho = "w-24",
}: {
  valor: number;
  onCambiar: (v: number) => void;
  sufijo?: string;
  prefijo?: string;
  ancho?: string;
}) => {
  const [texto, setTexto] = useState(String(valor));

  // Si el valor cambia desde afuera (restaurar), el campo lo sigue.
  useEffect(() => setTexto(String(valor)), [valor]);

  return (
    <div className={`relative ${ancho}`}>
      {prefijo && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
          {prefijo}
        </span>
      )}
      <input
        type="number"
        inputMode="numeric"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) onCambiar(n);
        }}
        className={`input text-right tabular [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${
          prefijo ? "pl-7" : ""
        } ${sufijo ? "pr-7" : ""}`}
      />
      {sufijo && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
          {sufijo}
        </span>
      )}
    </div>
  );
};

const Reventa = () => {
  const [productos, setProductos] = useState<Fila[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [config, setConfigState] = useState<ConfigReventa>(getConfig);
  const [visibles, setVisibles] = useState(PAGINA);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Mismo criterio que Productos: los filtros en la URL sobreviven a ir y
  // volver del detalle de un producto.
  const [params, setParams] = useSearchParams();

  const busqueda = params.get("q") ?? "";
  const categoria = params.get("cat") ?? "";
  // Por defecto solo lo que está a la venta en la tienda: lo oculto
  // normalmente no se ofrece a revendedores tampoco.
  const incluirOcultos = params.get("ocultos") === "1";
  const revisarParam = params.get("revisar");
  const revisar = revisarParam && revisarParam in REVISAR ? (revisarParam as Revisar) : null;
  const ordenParam = params.get("orden");
  const orden: OrdenId = ordenParam && ordenParam in ORDENES ? (ordenParam as OrdenId) : "modelo";

  const setParam = (clave: string, valor: string | null) =>
    setParams(
      (anterior) => {
        const siguiente = new URLSearchParams(anterior);
        if (valor) siguiente.set(clave, valor);
        else siguiente.delete(clave);
        return siguiente;
      },
      { replace: true }
    );

  // Cada cambio de configuración queda guardado al toque: es una mesa de
  // trabajo, no un formulario con "Guardar".
  const cambiarConfig = (c: ConfigReventa) => {
    setConfigState(c);
    setConfig(c);
  };

  const cambiarNivel = (id: string, cambio: Partial<Nivel>) =>
    cambiarConfig({
      ...config,
      niveles: config.niveles.map((n) => (n.id === id ? { ...n, ...cambio } : n)),
    });

  useEffect(() => {
    (async () => {
      const [p, c] = await Promise.all([
        supabase
          .from("products")
          .select("id,model,title,provider,category,thumbnail,cost,effective_price,is_active")
          .order("model"),
        supabase.from("categories").select("name").order("name"),
      ]);

      if (p.error ?? c.error) setError((p.error ?? c.error)!.message);

      setProductos((p.data ?? []) as Fila[]);
      setCategorias((c.data ?? []).map((x) => x.name));
      setCargando(false);
    })();
  }, []);

  // Lo que entra en la cuenta: a la venta (salvo que se pidan los ocultos) y
  // con costo cargado. Los resúmenes salen de acá y no de lo filtrado por
  // búsqueda, para que el número de arriba sea el de toda la lista.
  const base = useMemo(
    () => productos.filter((p) => incluirOcultos || p.is_active),
    [productos, incluirOcultos]
  );
  const conCosto = useMemo(() => base.filter(tieneCosto), [base]);
  const sinCosto = base.length - conCosto.length;

  const resumen = useMemo(
    () =>
      config.niveles.map((n) => {
        const precios = conCosto.map((p) =>
          precioNivel(p.cost, p.effective_price, n.descuento, config.piso)
        );
        const topeados = precios.filter((x) => x.topeado).length;
        const venta = precios.reduce((s, x) => s + x.precio, 0);
        const ganancia = precios.reduce((s, x) => s + x.ganancia, 0);
        const costo = venta - ganancia;

        return {
          nivel: n,
          topeados,
          completos: precios.length - topeados,
          // Ponderado por plata y no promedio de porcentajes: un producto de
          // $5.000 con 80% no compensa uno de $500.000 con 20%.
          margen: costo > 0 ? (ganancia / costo) * 100 : 0,
        };
      }),
    [conCosto, config]
  );

  const filtrados = useMemo(() => {
    const terminos = busqueda.toLowerCase().split(/\s+/).filter(Boolean);

    const lista = conCosto.filter((p) => {
      if (categoria && p.category !== categoria) return false;
      if (revisar && !REVISAR[revisar].test(p, config)) return false;
      if (terminos.length === 0) return true;

      const texto = `${p.model} ${p.title} ${p.provider ?? ""}`.toLowerCase();
      return terminos.every((t) => texto.includes(t));
    });

    if (orden === "modelo") return lista;

    const signo = orden === "desc-asc" ? 1 : -1;
    const dm = (p: ConCosto) => descuentoMaximo(p.cost, p.effective_price, config.piso) ?? -Infinity;
    return [...lista].sort((a, b) => (dm(a) - dm(b)) * signo);
  }, [conCosto, busqueda, categoria, revisar, orden, config]);

  useEffect(() => setVisibles(PAGINA), [busqueda, categoria, revisar, orden, incluirOcultos]);

  if (cargando) return <Loading />;

  const hayFiltros = ["q", "cat", "revisar", "ocultos", "orden"].some((k) => params.has(k));

  return (
    <>
      <PageTitle
        action={
          <span className="text-sm text-neutral-500">
            {number(filtrados.length)}
            {filtrados.length !== conCosto.length && ` de ${number(conCosto.length)}`} productos
          </span>
        }
      >
        Reventa
      </PageTitle>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      {/* Configuración */}
      <div className="card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label">Ganancia mínima sobre el costo</p>
            <InputNumero
              valor={config.piso}
              onCambiar={(v) => cambiarConfig({ ...config, piso: v })}
              sufijo="%"
            />
          </div>
          <p className="max-w-md text-xs text-neutral-500">
            Cobro por transferencia: sin comisión de pasarela. El descuento de cada nivel se aplica
            sobre el precio público de la tienda; si en un producto deja la ganancia por debajo del
            mínimo, ese producto queda <Badge tone="amber">en el piso</Badge> y el revendedor recibe
            menos descuento.
          </p>
          <button
            onClick={() => cambiarConfig(CONFIG_DEFECTO)}
            className="text-sm text-neutral-500 transition hover:text-neutral-900"
          >
            Restaurar valores
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-neutral-200">
              <tr>
                <th className="th pl-0">Nivel</th>
                <th className="th text-right">Descuento</th>
                <th className="th text-right">Compra mínima</th>
                <th className="th text-right">Descuento completo</th>
                <th className="th text-right">En el piso</th>
                <th className="th text-right">Ganancia promedio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {resumen.map(({ nivel, completos, topeados, margen }) => (
                <tr key={nivel.id}>
                  <td className="td pl-0">
                    <input
                      value={nivel.nombre}
                      onChange={(e) => cambiarNivel(nivel.id, { nombre: e.target.value })}
                      aria-label="Nombre del nivel"
                      className="input w-40 font-medium"
                    />
                  </td>
                  <td className="td">
                    <div className="flex justify-end">
                      <InputNumero
                        valor={nivel.descuento}
                        onCambiar={(v) => cambiarNivel(nivel.id, { descuento: Math.min(v, 99) })}
                        sufijo="%"
                      />
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex justify-end">
                      <InputNumero
                        valor={nivel.minimo}
                        onCambiar={(v) => cambiarNivel(nivel.id, { minimo: v })}
                        prefijo="$"
                        ancho="w-36"
                      />
                    </div>
                  </td>
                  <td className="td tabular text-right">{number(completos)}</td>
                  <td className="td text-right">
                    {topeados > 0 ? (
                      <Badge tone="amber">{number(topeados)}</Badge>
                    ) : (
                      <span className="tabular text-neutral-400">0</span>
                    )}
                  </td>
                  <td className="td tabular text-right font-medium">{pct(margen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Productos con precio de reventa" value={number(conCosto.length)} hint={incluirOcultos ? "Incluye ocultos" : "Solo visibles en la tienda"} />
        <Stat
          label="Sin costo cargado"
          value={number(sinCosto)}
          hint="Quedan afuera: sin costo no se sabe si se gana"
        />
        <Stat
          label="Precio público bajo el piso"
          value={number(conCosto.filter((p) => REVISAR["bajo-piso"].test(p, config)).length)}
          hint={`Ni sin descuento llegan al ${pct(config.piso)}`}
        />
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setParam("q", e.target.value || null)}
          placeholder="Buscar por modelo, título o marca…"
          className="input max-w-xs"
        />
        <select
          value={categoria}
          onChange={(e) => setParam("cat", e.target.value || null)}
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
        <select
          value={orden}
          onChange={(e) => setParam("orden", e.target.value === "modelo" ? null : e.target.value)}
          className="input w-auto"
        >
          {(Object.keys(ORDENES) as OrdenId[]).map((k) => (
            <option key={k} value={k}>{ORDENES[k]}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={incluirOcultos}
            onChange={(e) => setParam("ocultos", e.target.checked ? "1" : null)}
            className="size-4 rounded border-neutral-300 text-primary focus:ring-primary/20"
          />
          Incluir ocultos
        </label>
        {hayFiltros && (
          <button
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="text-sm text-neutral-500 transition hover:text-neutral-900"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th className="th">Modelo</th>
              <th className="th text-right">Costo</th>
              <th className="th text-right">Público</th>
              <th
                className="th text-right"
                title="El descuento más grande sobre el precio público que todavía deja la ganancia mínima"
              >
                Desc. máx.
              </th>
              {config.niveles.map((n) => (
                <th key={n.id} className="th text-right">
                  {n.nombre} <span className="text-neutral-400">-{pct(n.descuento)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={4 + config.niveles.length} className="px-6 py-16 text-center text-sm text-neutral-500">
                  No hay productos que coincidan.
                </td>
              </tr>
            )}
            {filtrados.slice(0, visibles).map((p) => {
              const dm = descuentoMaximo(p.cost, p.effective_price, config.piso);

              return (
                <tr key={p.id} className="transition hover:bg-neutral-50">
                  <td className="td">
                    <Link to={`/productos/${p.id}`} className="font-medium text-neutral-900 hover:underline">
                      {p.model}
                    </Link>
                    <p className="text-xs text-neutral-400">
                      {p.provider}
                      {!p.is_active && " · oculto"}
                    </p>
                  </td>
                  <td className="td tabular text-right text-neutral-500">{money(p.cost)}</td>
                  <td className="td tabular text-right">{money(p.effective_price)}</td>
                  <td className="td text-right">
                    {dm == null ? (
                      <span className="text-neutral-400">—</span>
                    ) : dm < 0 ? (
                      <Badge tone="red">bajo el piso</Badge>
                    ) : (
                      <span className="tabular text-neutral-600">{pct(Math.floor(dm))}</span>
                    )}
                  </td>
                  {config.niveles.map((n) => {
                    const x = precioNivel(p.cost, p.effective_price, n.descuento, config.piso);

                    return (
                      <td key={n.id} className="td text-right">
                        <p className="tabular font-medium">{money(x.precio)}</p>
                        <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-neutral-500">
                          {x.topeado && <Badge tone="amber">piso</Badge>}
                          <span
                            className="tabular"
                            title={`Ganancia nuestra ${money(x.ganancia)} · el revendedor gana ${pct(
                              x.margenRevendedor
                            )} vendiendo a precio público`}
                          >
                            +{pct(x.margen)} · rev. {pct(x.margenRevendedor)}
                          </span>
                        </p>
                      </td>
                    );
                  })}
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
    </>
  );
};

export default Reventa;
