import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ItemGaleria } from "@/lib/images";
import { Badge } from "@/components/ui";

type Candidato = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  exacto: boolean;
  pictures: Array<{ id: string; url: string }>;
};

// La galería admite 12 fotos; la Edge Function rechaza más.
const MAX_GALERIA = 12;

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

/**
 * Busca el producto en el catálogo de MercadoLibre y agrega sus fotos a la
 * galería. Acá solo se agregan a la lista: se descargan y se guardan en R2
 * recién con "Guardar cambios", junto con el resto.
 */
const MeliFotos = ({
  productId,
  items,
  onChange,
}: {
  productId: string;
  items: ItemGaleria[];
  onChange: (items: ItemGaleria[]) => void;
}) => {
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");

  const buscar = async () => {
    setBuscando(true);
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke("meli-listings", {
        body: { action: "catalog", product_id: productId },
      });
      if (error) throw new Error(await mensajeDe(error));
      if (data?.error) throw new Error(data.error);
      // Los del mismo modelo primero: son los únicos en los que se puede confiar.
      // Las URLs del catálogo a veces vienen en http, y en un panel https el
      // navegador las bloquea o avisa.
      const lista = ((data?.candidates ?? []) as Candidato[])
        .map((c) => ({
          ...c,
          pictures: c.pictures.map((f) => ({ ...f, url: f.url.replace(/^http:\/\//, "https://") })),
        }))
        .filter((c) => c.pictures.some((f) => f.url))
        .sort((a, b) => Number(b.exacto) - Number(a.exacto));
      setCandidatos(lista);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscando(false);
    }
  };

  const yaEstan = new Set(items.flatMap((it) => (it.tipo === "meli" ? [it.url] : [])));
  const lugar = Math.max(0, MAX_GALERIA - items.length);

  const agregar = (c: Candidato) => {
    const nuevas: ItemGaleria[] = c.pictures
      .filter((f) => f.url && !yaEstan.has(f.url))
      .slice(0, lugar)
      .map((f) => ({ id: `meli-${f.id}`, tipo: "meli" as const, url: f.url, preview: f.url }));
    if (nuevas.length) onChange([...items, ...nuevas]);
  };

  return (
    <div className="mt-4 border-t border-neutral-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          Fotos del catálogo de MercadoLibre. Se copian a nuestro almacenamiento al guardar.
        </p>
        <button type="button" onClick={buscar} disabled={buscando} className="btn-ghost">
          {buscando ? "Buscando…" : candidatos ? "Buscar de nuevo" : "Buscar en MercadoLibre"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {candidatos && (
        <div className="mt-3 space-y-3">
          {candidatos.length === 0 && (
            <p className="text-xs text-neutral-400">No hay fichas con fotos para este producto en el catálogo.</p>
          )}

          {candidatos.map((c) => {
            const pendientes = c.pictures.filter((f) => f.url && !yaEstan.has(f.url)).length;
            const van = Math.min(pendientes, lugar);
            return (
              <div key={c.id} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                      {c.brand ?? "—"} · modelo {c.model ?? "—"}
                      {c.exacto ? (
                        <Badge tone="green">mismo modelo</Badge>
                      ) : (
                        <Badge tone="amber">modelo distinto</Badge>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => agregar(c)}
                    disabled={van === 0}
                    className="btn-ghost shrink-0"
                  >
                    {pendientes === 0 ? "Ya agregadas" : van === 0 ? "Galería llena" : `Agregar ${van} fotos`}
                  </button>
                </div>

                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                  {c.pictures.filter((f) => f.url).map((f) => (
                    <img
                      key={f.id}
                      src={f.url}
                      alt=""
                      loading="lazy"
                      className={`size-14 shrink-0 rounded border border-neutral-200 bg-white object-contain ${
                        yaEstan.has(f.url) ? "opacity-40" : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MeliFotos;
