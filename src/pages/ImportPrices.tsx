import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { getComision } from "@/lib/comision";
import { PageTitle, Badge, ErrorBox } from "@/components/ui";
import { calcularCambios, cruzar, leerLista, type Cambio } from "@/lib/importador";
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

const ImportPrices = () => {
  const comision = getComision();

  const [csv, setCsv] = useState("");
  const [productos, setProductos] = useState<Product[] | null>(null);
  const [cambios, setCambios] = useState<Cambio[] | null>(null);
  const [sinMatch, setSinMatch] = useState<string[]>([]);
  const [sinCambio, setSinCambio] = useState(0);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});

  const [analizando, setAnalizando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState("");

  const analizar = async () => {
    setError("");
    setResultado("");
    setAnalizando(true);

    try {
      const items = leerLista(csv);

      if (items.length === 0) {
        setError(
          "No se reconoció ningún ítem. Copiá el contenido de la pestaña del sheet, incluyendo la columna del modelo y la del precio."
        );
        setCambios(null);
        return;
      }

      // El catálogo entero: son ~700 filas, entra en una sola consulta y evita
      // ir y volver por cada modelo de la lista.
      let filas = productos;
      if (!filas) {
        const { data, error: e } = await supabase
          .from("products")
          .select("*")
          .order("model");
        if (e) throw e;
        filas = (data ?? []) as Product[];
        setProductos(filas);
      }

      const coincidencias = cruzar(items, filas);
      const nuevos = calcularCambios(coincidencias, comision);

      setCambios(nuevos);
      setSinMatch(
        coincidencias.filter((c) => c.producto == null).map((c) => c.item.modelo)
      );
      setSinCambio(coincidencias.filter((c) => c.producto != null).length - nuevos.length);

      // Nada viene tildado a propósito. Tildar es la decisión.
      setMarcados({});
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

  const aPerdida = (cambios ?? []).filter((c) => c.aPerdida).length;

  return (
    <>
      <PageTitle>Importar lista del proveedor</PageTitle>

      <p className="mb-6 max-w-2xl text-sm text-neutral-500">
        Abrí la pestaña de la marca en el sheet, seleccioná todo y pegalo acá.
        También sirve el CSV descargado (Archivo → Descargar → CSV). Se importa
        el <strong>costo</strong>; el precio de venta lo recalcula la base con el
        margen de cada producto.
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

      {cambios && (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium text-neutral-900">
              {cambios.length} {cambios.length === 1 ? "cambio" : "cambios"}
            </span>
            {sinCambio > 0 && (
              <span className="text-neutral-500">{sinCambio} sin cambios</span>
            )}
            {sinMatch.length > 0 && (
              <span className="text-neutral-500">
                {sinMatch.length} sin encontrar en el catálogo
              </span>
            )}
            {aPerdida > 0 && (
              <Badge tone="red">
                {aPerdida} quedarían a pérdida
              </Badge>
            )}
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

          {sinMatch.length > 0 && (
            <details className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-neutral-700">
                {sinMatch.length} de la lista no se encontraron en el catálogo
              </summary>
              <p className="mt-2 text-xs text-neutral-500">
                O no los vendemos, o el modelo está escrito distinto en la base.
                Si alguno debería estar, corregí el modelo en el producto y
                volvé a analizar.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {sinMatch.map((m) => (
                  <span
                    key={m}
                    className="rounded-md bg-white px-2 py-1 font-mono text-xs text-neutral-600 ring-1 ring-neutral-200"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );
};

export default ImportPrices;
