import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase, traerTodo } from "@/lib/supabase";
import { money } from "@/lib/format";
import { ErrorBox, Loading, PageTitle } from "@/components/ui";
import type { Product } from "@/lib/types";

type Producto = Pick<Product, "id" | "model" | "title" | "category" | "thumbnail" | "effective_price">;
type Linea = { producto: Producto; cantidad: number };
const cantidadValida = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 9999;
const importe = (n: number) => Math.round(n * 100) / 100;

const Foto = ({ producto }: { producto: Producto }) => (
  <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-100 bg-white">
    {producto.thumbnail ? <img src={producto.thumbnail} alt="" className="size-full object-contain" /> : <span className="text-xs text-neutral-400">Sin foto</span>}
  </div>
);

const Cantidad = ({ valor, nombre, onChange }: { valor: number; nombre: string; onChange: (n: number) => void }) => {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  return <input type="number" min="1" max="9999" step="1" inputMode="numeric" aria-label={`Cantidad de ${nombre}`} className="input w-20 text-center" value={texto}
    onChange={(e) => { setTexto(e.target.value); const n = Number(e.target.value); if (cantidadValida(n)) onChange(n); }}
    onBlur={() => setTexto(String(valor))} />;
};

export default function Presupuestar() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [limite, setLimite] = useState(30);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cliente, setCliente] = useState("");
  const [nota, setNota] = useState("");
  const [descuentoTexto, setDescuentoTexto] = useState("");
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const [fecha] = useState(() => new Date().toLocaleDateString("es-AR"));

  useEffect(() => {
    let activo = true;
    traerTodo<Producto>((desde, hasta) => supabase.from("products")
      .select("id,model,title,category,thumbnail,effective_price")
      .eq("is_active", true).order("model").order("id").range(desde, hasta))
      .then((data) => { if (activo) setProductos(data); })
      .catch((e: unknown) => { if (activo) setError(e instanceof Error ? e.message : "No se pudieron cargar los productos."); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  useEffect(() => { setLimite(30); }, [busqueda, categoria]);
  useEffect(() => {
    if (!vistaPrevia) return;
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    const teclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVistaPrevia(false);
      if (e.key === "Tab") { e.preventDefault(); cerrarRef.current?.focus(); }
    };
    window.addEventListener("keydown", teclado);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", teclado); anterior?.focus(); };
  }, [vistaPrevia]);

  const categorias = useMemo(() => [...new Set(productos.map((p) => p.category))].sort(), [productos]);
  const filtrados = useMemo(() => {
    const terminos = busqueda.trim().toLocaleLowerCase().split(/\s+/);
    return productos.filter((p) => (!categoria || p.category === categoria) && terminos.every((t) => `${p.model} ${p.title}`.toLocaleLowerCase().includes(t)));
  }, [productos, busqueda, categoria]);
  const subtotal = importe(lineas.reduce((s, l) => s + importe(l.producto.effective_price * l.cantidad), 0));
  const descuentoPct = Number(descuentoTexto);
  const descuentoValido = Number.isFinite(descuentoPct) && descuentoPct >= 0 && descuentoPct <= 100;
  const descuento = descuentoValido ? importe(subtotal * descuentoPct / 100) : 0;
  const total = importe(subtotal - descuento);
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const agregar = (producto: Producto) => setLineas((actual) => {
    const existe = actual.find((l) => l.producto.id === producto.id);
    return existe ? actual.map((l) => l.producto.id === producto.id ? { ...l, cantidad: Math.min(9999, l.cantidad + 1) } : l) : [...actual, { producto, cantidad: 1 }];
  });

  const presupuesto = (editable: boolean) => (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 p-6">
        <div><img src="/vigi.svg" alt="VIGI" className="mb-4 h-8" /><h2 id={editable ? undefined : "presupuesto-titulo"} className="text-xl font-semibold">Presupuesto</h2><p className="mt-1 text-sm text-neutral-500">{fecha}</p></div>
        {cliente.trim() && <div className="max-w-full text-sm"><p className="text-neutral-500">Preparado para</p><p className="mt-1 break-words font-medium">{cliente.trim()}</p></div>}
      </div>
      {lineas.length === 0 ? <p className="px-6 py-14 text-center text-sm text-neutral-400">Agregá productos para armar el presupuesto.</p> : <div className="divide-y divide-neutral-100 px-4 sm:px-6">
        {lineas.map(({ producto, cantidad }) => <div key={producto.id} className="flex flex-wrap items-center gap-3 py-5">
          <Foto producto={producto} />
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{producto.title}</p><p className="mt-1 break-words text-xs text-neutral-500">{producto.model}</p><p className="mt-2 text-sm text-neutral-600">{money(producto.effective_price)} c/u</p></div>
          <div className="flex w-full items-center justify-end gap-4 sm:w-auto">
            {editable ? <Cantidad valor={cantidad} nombre={producto.model} onChange={(n) => setLineas((actual) => actual.map((l) => l.producto.id === producto.id ? { ...l, cantidad: n } : l))} /> : <span className="text-sm text-neutral-500">× {cantidad}</span>}
            <span className="min-w-24 text-right text-sm font-semibold tabular">{money(importe(producto.effective_price * cantidad))}</span>
            {editable && <button type="button" onClick={() => setLineas((actual) => actual.filter((l) => l.producto.id !== producto.id))} aria-label={`Quitar ${producto.model}`} className="p-2 text-neutral-400 hover:text-red-600">×</button>}
          </div>
        </div>)}
      </div>}
      <div className="border-t border-neutral-200 bg-neutral-50 p-6">
        <p className="mb-3 text-sm text-neutral-500">{unidades} {unidades === 1 ? "unidad" : "unidades"}</p>
        {descuentoValido && descuentoPct > 0 && <div className="mb-4 space-y-2 border-b border-neutral-200 pb-4 text-sm">
          <div className="flex justify-between gap-4"><span className="text-neutral-600">Subtotal</span><span className="tabular">{money(subtotal)}</span></div>
          <div className="flex justify-between gap-4 text-green-700"><span>Descuento ({descuentoPct.toLocaleString("es-AR") }%)</span><span className="tabular">−{money(descuento)}</span></div>
        </div>}
        <div className="flex items-center justify-between gap-4"><span className="text-lg font-semibold">Total</span><span className="tabular text-2xl font-bold text-primary">{money(total)}</span></div>
        <p className="mt-3 text-xs text-neutral-500">Envío no incluido.</p>
      </div>
      {nota.trim() && <p className="whitespace-pre-wrap break-words border-t border-neutral-100 p-6 text-sm text-neutral-600">{nota.trim()}</p>}
    </div>
  );

  return <>
    <PageTitle action={<button type="button" className="btn-primary" disabled={!lineas.length || !descuentoValido} onClick={() => setVistaPrevia(true)}>Vista para captura</button>}>Presupuestar</PageTitle>
    <p className="-mt-3 mb-6 text-sm text-neutral-500">Elegí productos y cantidades. El presupuesto usa los precios finales de la tienda.</p>
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_1.2fr]">
      <section className="card p-4">
        <h2 className="mb-4 font-semibold">Seleccionar productos</h2>
        <input className="input" placeholder="Buscar por modelo o nombre…" aria-label="Buscar productos" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select className="input mt-3" aria-label="Filtrar por categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Todas las categorías</option>{categorias.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        {cargando ? <Loading /> : error ? <div className="mt-4"><ErrorBox>{error}</ErrorBox></div> : <>
          <p className="my-4 text-xs text-neutral-500">{filtrados.length} productos</p>
          <div className="max-h-[600px] space-y-3 overflow-y-auto">
            {filtrados.slice(0, limite).map((p) => {
              const precioValido = p.effective_price != null && Number.isFinite(p.effective_price) && p.effective_price >= 0;
              return <div key={p.id} className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3"><Foto producto={p} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{p.title}</p><p className="break-words text-xs text-neutral-500">{p.model}</p><p className="mt-1 text-sm font-semibold">{precioValido ? money(p.effective_price) : "Sin precio"}</p></div><button type="button" className="btn-ghost px-3" disabled={!precioValido || lineas.some((l) => l.producto.id === p.id && l.cantidad >= 9999)} aria-label={`Agregar ${p.model}`} onClick={() => agregar(p)}>+</button></div>;
            })}
            {!filtrados.length && <p className="py-8 text-center text-sm text-neutral-500">No se encontraron productos.</p>}
            {filtrados.length > limite && <button type="button" className="btn-ghost w-full" onClick={() => setLimite((n) => n + 30)}>Ver más productos</button>}
          </div>
        </>}
      </section>
      <section className="space-y-4">
        <div className="card p-4">
          <label htmlFor="presupuesto-descuento" className="mb-1.5 block text-sm">Descuento (%)</label>
          <input id="presupuesto-descuento" type="number" min="0" max="100" step="any" inputMode="decimal" className="input" placeholder="0" value={descuentoTexto} onChange={(e) => setDescuentoTexto(e.target.value)} aria-invalid={!descuentoValido} aria-describedby="descuento-ayuda" />
          <p id="descuento-ayuda" className={`mt-2 text-xs ${descuentoValido ? "text-neutral-500" : "text-red-600"}`}>{descuentoValido ? "Se aplica sobre el subtotal de todos los productos." : "Ingresá un porcentaje entre 0 y 100."}</p>
        </div>
        <div className="card space-y-4 p-4"><label className="block text-sm">Cliente (opcional)<input className="input mt-1.5" value={cliente} maxLength={150} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre del cliente" /></label><label className="block text-sm">Nota (opcional)<textarea className="input mt-1.5" rows={2} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Condiciones, forma de pago o aclaraciones" /></label></div>
        {presupuesto(true)}
        {!!lineas.length && <button type="button" className="btn-ghost" onClick={() => { if (window.confirm("¿Vaciar el presupuesto y empezar uno nuevo?")) { setLineas([]); setCliente(""); setNota(""); setDescuentoTexto(""); } }}>Nuevo presupuesto</button>}
      </section>
    </div>
    {vistaPrevia && createPortal(<div role="dialog" aria-modal="true" aria-labelledby="presupuesto-titulo" className="fixed inset-0 z-50 overflow-y-auto bg-neutral-100">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-4 py-3"><p className="text-sm text-neutral-500">Capturá el presupuesto de abajo para enviarlo al cliente.</p><button ref={cerrarRef} type="button" className="btn-ghost shrink-0" onClick={() => setVistaPrevia(false)}>Volver a editar</button></div>
      <div className="mx-auto max-w-3xl px-4 py-6">{presupuesto(false)}</div>
    </div>, document.body)}
  </>;
}
