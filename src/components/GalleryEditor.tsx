import { useRef, useState, type DragEvent } from "react";
import type { ItemGaleria } from "@/lib/images";

const nuevoId = () => Math.random().toString(36).slice(2);

const desdeArchivos = (files: File[]): ItemGaleria[] =>
  files
    .filter((f) => f.type.startsWith("image/"))
    .map((f) => ({
      id: nuevoId(),
      tipo: "nueva" as const,
      archivo: f,
      preview: URL.createObjectURL(f),
    }));

const GalleryEditor = ({
  items,
  onChange,
}: {
  items: ItemGaleria[];
  onChange: (items: ItemGaleria[]) => void;
}) => {
  const [sobreZona, setSobreZona] = useState(false);
  // El índice arrastrado va en un ref, no en estado: el handler de drop lo lee
  // por closure, y con estado dependería de que React haya re-renderizado entre
  // el dragstart y el drop. Con un arrastre lento anda; con uno rápido, no.
  const arrastrando = useRef<number | null>(null);
  const [encima, setEncima] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const agregar = (files: FileList | File[] | null) => {
    if (!files) return;
    const nuevos = desdeArchivos([...files]);
    if (nuevos.length) onChange([...items, ...nuevos]);
  };

  const quitar = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (it?.tipo === "nueva") URL.revokeObjectURL(it.preview);
    onChange(items.filter((x) => x.id !== id));
  };

  // Reordenar: se saca el arrastrado y se reinserta en la posición destino.
  const soltarEn = (destino: number) => {
    const origen = arrastrando.current;
    if (origen === null || origen === destino) return;

    const copia = [...items];
    const [movido] = copia.splice(origen, 1);
    copia.splice(destino, 0, movido);

    onChange(copia);
    arrastrando.current = null;
    setEncima(null);
  };

  const onDropZona = (e: DragEvent) => {
    e.preventDefault();
    setSobreZona(false);
    // Solo archivos del sistema; un reorden interno no trae files.
    if (e.dataTransfer.files?.length) agregar(e.dataTransfer.files);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {items.length === 0
            ? "Sin imágenes"
            : `${items.length} ${items.length === 1 ? "imagen" : "imágenes"} · la primera es la principal`}
        </p>
        {items.length > 1 && (
          <p className="text-xs text-neutral-400">Arrastrá para reordenar</p>
        )}
      </div>

      {items.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((it, i) => (
            <li
              key={it.id}
              draggable
              onDragStart={() => { arrastrando.current = i; setEncima(i); }}
              onDragEnd={() => { arrastrando.current = null; setEncima(null); }}
              onDragOver={(e) => { e.preventDefault(); setEncima(i); }}
              onDragLeave={() => setEncima((v) => (v === i ? null : v))}
              onDrop={(e) => { e.preventDefault(); soltarEn(i); }}
              className={`group relative aspect-square cursor-grab overflow-hidden rounded-lg border bg-neutral-50 transition
                ${encima === i && arrastrando.current !== i ? "border-primary ring-2 ring-primary/20" : "border-neutral-200"}
                ${arrastrando.current === i ? "opacity-40" : ""}`}
            >
              <img src={it.preview} alt="" className="size-full object-contain" />

              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Principal
                </span>
              )}
              {it.tipo === "nueva" && (
                <span className="absolute bottom-1.5 left-1.5 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Nueva
                </span>
              )}

              <button
                type="button"
                onClick={() => quitar(it.id)}
                title="Quitar"
                className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-white/90 text-neutral-500 opacity-0 shadow-sm transition hover:text-red-600 group-hover:opacity-100"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setSobreZona(true); }}
        onDragLeave={() => setSobreZona(false)}
        onDrop={onDropZona}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition
          ${sobreZona ? "border-primary bg-primary/5" : "border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
             className={sobreZona ? "text-primary" : "text-neutral-400"}>
          <path d="M12 16V4m0 0L7 9m5-5l5 5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 15v3a2 2 0 002 2h14a2 2 0 002-2v-3" strokeLinecap="round" />
        </svg>
        <p className="mt-2 text-sm text-neutral-600">
          {sobreZona ? "Soltá las imágenes" : "Arrastrá imágenes o hacé clic"}
        </p>
        <p className="mt-0.5 text-xs text-neutral-400">PNG o JPG, hasta 8 MB</p>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { agregar(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
};

export default GalleryEditor;
