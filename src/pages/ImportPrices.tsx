import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { getComision } from "@/lib/comision";
import { PageTitle, Badge, ErrorBox } from "@/components/ui";
import {
  SHEET_PROVEEDOR,
  adivinarCategoria,
  calcularCambios,
  cruzar,
  faltantes,
  leerLista,
  marcaProbable,
  productoNuevo,
  reaparecidos,
  type Cambio,
  type Coincidencia,
  type ItemLista,
} from "@/lib/importador";
import type { Product } from "@/lib/types";

/**
 * Importar la lista del proveedor.
 *
 * Se pega el CSV de una pestaña del sheet y se ve qué cambiaría. Nada se
 * escribe hasta que alguien tilda y confirma: un modelo mal cruzado cambia el
 * precio de un producto en una tienda viva y no se nota hasta que alguien
 * compra.
 *
 * Lo que se escribe es `cost`. El precio lo recalcula el trigger de la base con
 * el margen de cada producto, salvo que tenga precio fijado a mano.
 *
 * Además del costo, el cruce sirve para la disponibilidad: lo que tenemos de
 * la marca y la lista ya no trae se puede ocultar (`is_active`), lo oculto que
 * volvió se puede reactivar, y lo que la lista trae y no tenemos se puede dar
 * de alta (oculto, para completarle la ficha antes de mostrarlo).
 */

const Fila = ({
  cambio,
  marcado,
  onMarcar,
}: {
  cambio: Cambio;
  marcado: boolean;
  onMarcar: (v: boolean) => void;
}) => {
  const { producto, costoViejo, costoNuevo, variacionPct } = cambio;
  const subeCosto = variacionPct != null && variacionPct > 0;

  return (
    <tr className={cambio.aPerdida ? "bg-red-50/60" : undefined}>
      <td className="td">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => onMarcar(e.target.checked)}
          className="size-4 accent-neutral-900"
          aria-label={`Aplicar ${producto.model}`}
        />
      </td>

      <td className="td">
        <div className="font-medium text-neutral-900">{producto.model}</div>
        <div className="text-xs text-neutral-500">
          {producto.provider} · {producto.category}
        </div>
      </td>

      <td className="td text-right tabular-nums">
        <div className="text-neutral-500 line-through">
          {costoViejo == null ? "—" : money(costoViejo)}
        </div>
        <div className="font-medium text-neutral-900">{money(costoNuevo)}</div>
        {variacionPct != null && variacionPct !== 0 && (
          <div className={`text-xs ${subeCosto ? "text-red-600" : "text-green-700"}`}>
            {subeCosto ? "+" : ""}
            {variacionPct}%
          </div>
        )}
      </td>

      <td className="td text-right tabular-nums">
        <div className="text-neutral-500 line-through">{money(cambio.precioViejo)}</div>
        <div className="font-medium text-neutral-900">{money(cambio.precioNuevo)}</div>
      </td>

      <td className="td text-right tabular-nums">
        <div className="text-neutral-500">
          {cambio.gananciaVieja == null ? "—" : money(cambio.gananciaVieja)}
        </div>
        <div
          className={`font-medium ${
            cambio.aPerdida ? "text-red-600" : "text-green-700"
          }`}
        >
          {cambio.gananciaNueva == null ? "—" : money(cambio.gananciaNueva)}
        </div>
      </td>

      <td className="td">
        <div className="flex flex-col items-start gap-1">
          {cambio.aPerdida && <Badge tone="red">A pérdida</Badge>}
          {cambio.congelado && <Badge tone="amber">Precio fijado a mano</Badge>}
        </div>
      </td>
    </tr>
  );
};

// Una sección plegable con el mismo aspecto para las tres listas de revisión.
const Revision = ({
  titulo,
  desc,
  children,
}: {
  titulo: ReactNode;
  desc: ReactNode;
  children: ReactNode;
}) => (
  <details className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
    <summary className="cursor-pointer text-sm font-medium text-neutral-700">{titulo}</summary>
    <p className="mt-2 max-w-2xl text-xs text-neutral-500">{desc}</p>
    <div className="mt-3">{children}</div>
  </details>
);

const Tilde = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <input
    type="checkbox"
    checked={checked}
    onChange={(e) => onChange(e.target.checked)}
    className="size-4 accent-neutral-900"
    aria-label={label}
  />
);

const ImportPrices = () => {
  const comision = getComision();

  const [csv, setCsv] = useState("");
  const [productos, setProductos] = useState<Product[] | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [items, setItems] = useState<ItemLista[]>([]);
  const [coincidencias, setCoincidencias] = useState<Coincidencia[] | null>(null);
  const [cambios, setCambios] = useState<Cambio[] | null>(null);
  const [sinCambio, setSinCambio] = useState(0);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});

  // Disponibilidad y altas. Igual que con los costos, nada viene tildado.
  const [marca, setMarca] = useState("");
  const [ocultar, setOcultar] = useState<Record<string, boolean>>({});
  const [reactivar, setReactivar] = useState<Record<string, boolean>>({});
  const [altas, setAltas] = useState<Record<string, { marcado: boolean; categoria: string }>>({});

  const [analizando, setAnalizando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState("");

  // Cruza la lista contra el catálogo y arma todo lo que se muestra. Se vuelve
  // a llamar después de ocultar o dar de alta, con el catálogo recién leído.
  const recalcular = (lista: ItemLista[], filas: Product[], cats: string[]) => {
    const cruce = cruzar(lista, filas);
    const nuevos = calcularCambios(cruce, comision);

    setCoincidencias(cruce);
    setCambios(nuevos);
    setSinCambio(cruce.filter((c) => c.producto != null).length - nuevos.length);
    setMarca((m) => m || marcaProbable(cruce) || "");
    setAltas(
      Object.fromEntries(
        cruce
          .filter((c) => c.tipo === "nuevo")
          .map((c) => {
            const sugerida = adivinarCategoria(c.item.modelo, c.item.descripcion);
            return [
              c.item.modelo,
              { marcado: false, categoria: sugerida && cats.includes(sugerida) ? sugerida : "" },
            ];
          })
      )
    );

    setMarcados({});
    setOcultar({});
    setReactivar({});
  };

  // El catálogo entero: son ~700 filas, entra en una sola consulta y evita ir
  // y volver por cada modelo de la lista.
  const leerCatalogo = async () => {
    const [p, c] = await Promise.all([
      supabase.from("products").select("*").order("model"),
      supabase.from("categories").select("name").order("name"),
    ]);
    if (p.error) throw p.error;
    if (c.error) throw c.error;

    const filas = (p.data ?? []) as Product[];
    const cats = (c.data ?? []).map((x) => x.name as string);
    setProductos(filas);
    setCategorias(cats);
    return { filas, cats };
  };

  const analizar = async () => {
    setError("");
    setResultado("");
    setAnalizando(true);

    try {
      const lista = leerLista(csv);

      if (lista.length === 0) {
        setError(
          "No se reconoció ningún ítem. Copiá el contenido de la pestaña del sheet, incluyendo la columna del modelo y la del precio."
        );
        setCambios(null);
        setCoincidencias(null);
        return;
      }

      const { filas, cats } = productos
        ? { filas: productos, cats: categorias }
        : await leerCatalogo();

      setItems(lista);
      // Pestaña nueva, marca nueva: que la deduzca de nuevo.
      setMarca("");
      recalcular(lista, filas, cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la lista.");
    } finally {
      setAnalizando(false);
    }
  };

  const seleccionados = useMemo(
    () => (cambios ?? []).filter((c) => marcados[c.producto.id]),
    [cambios, marcados]
  );

  const marcas = useMemo(
    () =>
      [...new Set((productos ?? []).map((p) => p.provider).filter(Boolean) as string[])].sort(),
    [productos]
  );

  const listaFaltantes = useMemo(
    () => (productos && marca ? faltantes(items, productos, marca) : []),
    [items, productos, marca]
  );

  const listaReaparecidos = useMemo(
    () => (coincidencias ? reaparecidos(coincidencias) : []),
    [coincidencias]
  );

  const nuevos = (coincidencias ?? []).filter((c) => c.tipo === "nuevo");
  const ambiguos = (coincidencias ?? []).filter((c) => c.tipo === "ambiguo");

  const aplicar = async () => {
    if (seleccionados.length === 0) return;

    setAplicando(true);
    setError("");

    try {
      // De a uno y no en lote: el trigger que recalcula el precio corre por
      // fila, y así un producto que falle no arrastra a los demás.
      let ok = 0;
      for (const c of seleccionados) {
        const { error: e } = await supabase
          .from("products")
          .update({ cost: c.costoNuevo })
          .eq("id", c.producto.id);
        if (e) throw e;
        ok++;
      }

      setResultado(
        `${ok} ${ok === 1 ? "producto actualizado" : "productos actualizados"}. El precio se recalculó solo salvo en los que tienen precio fijado a mano.`
      );
      setCambios((prev) => (prev ?? []).filter((c) => !marcados[c.producto.id]));
      setMarcados({});
      setProductos(null); // el catálogo en memoria quedó viejo
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron aplicar los cambios.");
    } finally {
      setAplicando(false);
    }
  };

  // Ocultar y reactivar es `is_active`: el producto no se borra, deja de
  // verse en la tienda y vuelve cuando el proveedor lo repone.
  const cambiarVisibilidad = async (ids: string[], visible: boolean) => {
    if (ids.length === 0) return;

    setAplicando(true);
    setError("");
    setResultado("");

    try {
      const { error: e } = await supabase
        .from("products")
        .update({ is_active: visible })
        .in("id", ids);
      if (e) throw e;

      const { filas, cats } = await leerCatalogo();
      recalcular(items, filas, cats);
      setResultado(
        `${ids.length} ${ids.length === 1 ? "producto" : "productos"} ${
          visible ? "vuelven a verse en la tienda" : "ocultos de la tienda"
        }.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la visibilidad.");
    } finally {
      setAplicando(false);
    }
  };

  const altasMarcadas = nuevos.filter((c) => altas[c.item.modelo]?.marcado);
  const altasSinCategoria = altasMarcadas.filter((c) => !altas[c.item.modelo]?.categoria);

  const crearNuevos = async () => {
    if (altasMarcadas.length === 0 || altasSinCategoria.length > 0 || !marca) return;

    setAplicando(true);
    setError("");
    setResultado("");

    try {
      const filas = altasMarcadas.map((c) =>
        productoNuevo(c.item, marca, altas[c.item.modelo].categoria)
      );
      const { error: e } = await supabase.from("products").insert(filas);
      if (e) throw e;

      const catalogo = await leerCatalogo();
      recalcular(items, catalogo.filas, catalogo.cats);
      setResultado(
        `${filas.length} ${filas.length === 1 ? "producto creado" : "productos creados"} como ocultos. Cargales fotos y activalos desde el detalle.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron crear los productos.");
    } finally {
      setAplicando(false);
    }
  };

  const aPerdida = (cambios ?? []).filter((c) => c.aPerdida).length;
  const idsOcultar = listaFaltantes.filter((p) => ocultar[p.id]).map((p) => p.id);
  const idsReactivar = listaReaparecidos
    .filter((c) => reactivar[c.producto!.id])
    .map((c) => c.producto!.id);

  return (
    <>
      <PageTitle
        action={
          <a
            href={SHEET_PROVEEDOR}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost"
          >
            Abrir sheet del proveedor ↗
          </a>
        }
      >
        Importar lista del proveedor
      </PageTitle>

      <p className="mb-6 max-w-2xl text-sm text-neutral-500">
        Abrí la pestaña de la marca en el sheet, seleccioná todo y pegalo acá.
        También sirve el CSV descargado (Archivo → Descargar → CSV). Se importa
        el <strong>costo</strong>; el precio de venta lo recalcula la base con el
        margen de cada producto. Si la marca está en más de una pestaña, pegalas
        todas juntas.
      </p>

      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={'Pegá acá el contenido de la pestaña…'}
        className="w-full rounded-xl border border-neutral-200 bg-white p-3 font-mono text-xs outline-none transition focus:border-neutral-400"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={analizar}
          disabled={!csv.trim() || analizando}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {analizando ? "Analizando…" : "Analizar"}
        </button>
        {csv && (
          <button
            onClick={() => {
              setCsv("");
              setCambios(null);
              setCoincidencias(null);
              setItems([]);
              setMarca("");
              setError("");
              setResultado("");
            }}
            className="text-sm text-neutral-500 transition hover:text-neutral-900"
          >
            Limpiar
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      {resultado && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {resultado}
        </div>
      )}

      {cambios && coincidencias && (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium text-neutral-900">
              {cambios.length} {cambios.length === 1 ? "cambio" : "cambios"}
            </span>
            {sinCambio > 0 && (
              <span className="text-neutral-500">{sinCambio} sin cambios</span>
            )}
            {nuevos.length > 0 && (
              <span className="text-neutral-500">{nuevos.length} nuevos en la lista</span>
            )}
            {listaFaltantes.length > 0 && (
              <span className="text-neutral-500">
                {listaFaltantes.length} faltan en la lista
              </span>
            )}
            {aPerdida > 0 && (
              <Badge tone="red">
                {aPerdida} quedarían a pérdida
              </Badge>
            )}
            <label className="ml-auto flex items-center gap-2 text-neutral-500">
              Marca
              <select
                value={marca}
                onChange={(e) => {
                  setMarca(e.target.value);
                  setOcultar({});
                }}
                className="input w-auto py-1"
              >
                <option value="">—</option>
                {marcas.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {cambios.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Ningún costo cambió respecto de lo que ya está cargado.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th w-10">
                        <input
                          type="checkbox"
                          className="size-4 accent-neutral-900"
                          aria-label="Marcar todos"
                          checked={
                            cambios.length > 0 &&
                            cambios.every((c) => marcados[c.producto.id])
                          }
                          onChange={(e) =>
                            setMarcados(
                              e.target.checked
                                ? Object.fromEntries(
                                    cambios.map((c) => [c.producto.id, true])
                                  )
                                : {}
                            )
                          }
                        />
                      </th>
                      <th className="th">Producto</th>
                      <th className="th text-right">Costo</th>
                      <th className="th text-right">Precio</th>
                      <th className="th text-right">Ganancia neta</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody>
                    {cambios.map((c) => (
                      <Fila
                        key={c.producto.id}
                        cambio={c}
                        marcado={Boolean(marcados[c.producto.id])}
                        onMarcar={(v) =>
                          setMarcados((m) => ({ ...m, [c.producto.id]: v }))
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center gap-4">
                <button
                  onClick={aplicar}
                  disabled={seleccionados.length === 0 || aplicando}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {aplicando
                    ? "Aplicando…"
                    : `Aplicar ${seleccionados.length || ""}`.trim()}
                </button>
                <span className="text-xs text-neutral-500">
                  Se escribe solo el costo de los productos tildados.
                </span>
              </div>
            </>
          )}

          {/* --- Lo que tenemos y el proveedor ya no lista --- */}
          {listaFaltantes.length > 0 && (
            <Revision
              titulo={`${listaFaltantes.length} de ${marca} visibles en la tienda no están en la lista`}
              desc={
                <>
                  Puede que el proveedor ya no los tenga. También puede que estén
                  en otra pestaña de la misma marca o con el modelo escrito
                  distinto, así que revisalos antes. Ocultar no borra nada: el
                  producto deja de verse en la tienda y se puede reactivar.
                </>
              }
            >
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th w-10">
                        <Tilde
                          label="Marcar todos"
                          checked={listaFaltantes.every((p) => ocultar[p.id])}
                          onChange={(v) =>
                            setOcultar(
                              v ? Object.fromEntries(listaFaltantes.map((p) => [p.id, true])) : {}
                            )
                          }
                        />
                      </th>
                      <th className="th">Producto</th>
                      <th className="th text-right">Costo cargado</th>
                      <th className="th text-right">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaFaltantes.map((p) => (
                      <tr key={p.id}>
                        <td className="td">
                          <Tilde
                            label={`Ocultar ${p.model}`}
                            checked={Boolean(ocultar[p.id])}
                            onChange={(v) => setOcultar((o) => ({ ...o, [p.id]: v }))}
                          />
                        </td>
                        <td className="td">
                          <Link
                            to={`/productos/${p.id}`}
                            className="font-medium text-neutral-900 hover:underline"
                          >
                            {p.model}
                          </Link>
                          <div className="text-xs text-neutral-500">{p.title}</div>
                        </td>
                        <td className="td text-right tabular-nums">
                          {p.cost == null ? "—" : money(Number(p.cost))}
                        </td>
                        <td className="td text-right tabular-nums">
                          {money(Number(p.effective_price))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => cambiarVisibilidad(idsOcultar, false)}
                disabled={idsOcultar.length === 0 || aplicando}
                className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {`Ocultar ${idsOcultar.length || ""}`.trim()}
              </button>
            </Revision>
          )}

          {/* --- Ocultos que el proveedor volvió a listar --- */}
          {listaReaparecidos.length > 0 && (
            <Revision
              titulo={`${listaReaparecidos.length} ocultos volvieron a aparecer en la lista`}
              desc="Están en el catálogo pero no se ven en la tienda. Si los ocultaste porque el proveedor no los tenía, ahora los tiene de nuevo."
            >
              <div className="flex flex-col gap-2">
                {listaReaparecidos.map(({ producto, item }) => (
                  <label key={producto!.id} className="flex items-center gap-3 text-sm">
                    <Tilde
                      label={`Reactivar ${producto!.model}`}
                      checked={Boolean(reactivar[producto!.id])}
                      onChange={(v) => setReactivar((r) => ({ ...r, [producto!.id]: v }))}
                    />
                    <span className="font-medium text-neutral-900">{producto!.model}</span>
                    <span className="text-xs text-neutral-500">
                      {producto!.provider} · lista {money(item.costo)}
                    </span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => cambiarVisibilidad(idsReactivar, true)}
                disabled={idsReactivar.length === 0 || aplicando}
                className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {`Reactivar ${idsReactivar.length || ""}`.trim()}
              </button>
            </Revision>
          )}

          {/* --- Lo que el proveedor tiene y nosotros no --- */}
          {nuevos.length > 0 && (
            <Revision
              titulo={`${nuevos.length} de la lista no están en el catálogo`}
              desc={
                <>
                  O no los vendemos todavía, o el modelo está escrito distinto en
                  la base (en ese caso no los agregues: corregí el modelo y volvé
                  a analizar). Los que agregues se crean <strong>ocultos</strong>,
                  con la marca <strong>{marca || "—"}</strong>, el costo de la lista
                  y el margen por defecto.
                </>
              }
            >
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th w-10" />
                      <th className="th">Modelo</th>
                      <th className="th text-right">Costo</th>
                      <th className="th">Categoría</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nuevos.map(({ item }) => {
                      const alta = altas[item.modelo] ?? { marcado: false, categoria: "" };
                      const set = (cambio: Partial<typeof alta>) =>
                        setAltas((a) => ({ ...a, [item.modelo]: { ...alta, ...cambio } }));

                      return (
                        <tr key={item.modelo}>
                          <td className="td">
                            <Tilde
                              label={`Agregar ${item.modelo}`}
                              checked={alta.marcado}
                              onChange={(v) => set({ marcado: v })}
                            />
                          </td>
                          <td className="td">
                            <div className="font-mono text-xs font-medium text-neutral-900">
                              {item.modelo}
                            </div>
                            {item.descripcion && (
                              <div className="max-w-md truncate text-xs text-neutral-500">
                                {item.descripcion}
                              </div>
                            )}
                          </td>
                          <td className="td text-right tabular-nums">{money(item.costo)}</td>
                          <td className="td">
                            <select
                              value={alta.categoria}
                              onChange={(e) => set({ categoria: e.target.value })}
                              className="input w-auto py-1"
                            >
                              <option value="">Elegir…</option>
                              {categorias.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <button
                  onClick={crearNuevos}
                  disabled={
                    altasMarcadas.length === 0 ||
                    altasSinCategoria.length > 0 ||
                    !marca ||
                    aplicando
                  }
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {`Agregar ${altasMarcadas.length || ""}`.trim()}
                </button>
                {!marca && (
                  <span className="text-xs text-neutral-500">Elegí la marca arriba.</span>
                )}
                {altasSinCategoria.length > 0 && (
                  <span className="text-xs text-neutral-500">
                    Falta la categoría en {altasSinCategoria.length}.
                  </span>
                )}
              </div>
            </Revision>
          )}

          {/* --- El mismo modelo dos veces en la base --- */}
          {ambiguos.length > 0 && (
            <Revision
              titulo={`${ambiguos.length} con el modelo repetido en el catálogo`}
              desc="Hay más de un producto que coincide con el modelo, así que no se toca ninguno. Revisalos en Productos."
            >
              <div className="flex flex-wrap gap-1.5">
                {ambiguos.map(({ item }) => (
                  <span
                    key={item.modelo}
                    className="rounded-md bg-white px-2 py-1 font-mono text-xs text-neutral-600 ring-1 ring-neutral-200"
                  >
                    {item.modelo}
                  </span>
                ))}
              </div>
            </Revision>
          )}
        </div>
      )}
    </>
  );
};

export default ImportPrices;
