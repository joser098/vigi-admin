import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import { supabase } from "@/lib/supabase";
import { Loading, Empty } from "@/components/ui";
import { HojaTermica, VIGI } from "@/components/HojaTermica";
import type { Customer, Order } from "@/lib/types";

/**
 * Etiqueta de envío de una orden, al estilo de las de MercadoLibre, para la
 * térmica de 10×15. Se abre desde el detalle de la orden.
 *
 * Todo sale de la orden y del cliente: la dirección es la primera del
 * cliente, la misma que muestra el detalle de la orden.
 */
const EtiquetaEnvio = () => {
  const { id } = useParams<{ id: string }>();
  const [orden, setOrden] = useState<Order | null>(null);
  const [cliente, setCliente] = useState<Customer | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("orders").select("*, order_items(*)").eq("id", id).maybeSingle();
      const o = (data ?? null) as Order | null;
      setOrden(o);
      if (o) {
        const { data: c } = await supabase
          .from("customers")
          .select("*, addresses(*)")
          .eq("id", o.customer_id)
          .maybeSingle();
        setCliente((c ?? null) as Customer | null);
      }
      setCargando(false);
    })();
  }, [id]);

  if (cargando) return <Loading />;
  if (!orden) return <Empty>No se encontró la orden.</Empty>;

  return (
    <HojaTermica titulo={`Etiqueta de la orden ${orden.payment_id}`}>
      <Etiqueta orden={orden} cliente={cliente} />
    </HojaTermica>
  );
};

/** La etiqueta en sí, sin carga de datos. */
export const Etiqueta = ({ orden, cliente }: { orden: Order; cliente: Customer | null }) => {
  const barras = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!barras.current) return;
    JsBarcode(barras.current, orden.payment_id, {
      format: "CODE128",
      height: 80,
      width: 2,
      margin: 0,
      displayValue: false,
    });
  }, [orden.payment_id]);

  const d = cliente?.addresses?.[0];
  // Retiro en sucursal: el paquete va a la sucursal de Correo, no a la casa.
  const sucursal = orden.delivery_type === "S" ? orden.shipping_agency : null;
  const cp = sucursal ? sucursal.postal_code?.match(/\d{4}/)?.[0] : d?.zip_code;
  const articulos = (orden.order_items ?? []).reduce((t, i) => t + i.quantity, 0);
  const fecha = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="flex h-full flex-col p-[5mm] font-sans">
      {/* -------------------------------- Encabezado -------------------------------- */}
      <div className="flex items-center justify-between border-b-2 border-black pb-[2.5mm]">
        <img src="/vigi_black.svg" alt="VIGI" className="h-[9mm]" />
        <div className="text-right leading-tight">
          <p className="text-[11pt] font-black tracking-wide">ENVÍO</p>
          <p className="text-[8pt]">{fecha}</p>
        </div>
      </div>

      {/* -------------------------------- Remitente -------------------------------- */}
      <p className="mt-[2mm] text-[7.5pt] leading-snug">
        <span className="font-bold uppercase">Remitente:</span> {VIGI.nombre} · Tel. {VIGI.telefono} · {VIGI.web}
      </p>

      {/* ------------------------------- Destinatario ------------------------------- */}
      <div className="mt-[2.5mm] rounded-[2mm] border-2 border-black p-[3mm]">
        <p className="text-[7.5pt] font-bold uppercase tracking-wide">Destinatario</p>
        <p className="mt-[1mm] text-[15pt] font-black uppercase leading-tight">
          {cliente ? `${cliente.name} ${cliente.last_name}` : "—"}
        </p>

        {sucursal ? (
          <div className="mt-[2mm] text-[11pt] leading-snug">
            <p className="text-[9pt] font-black uppercase">Retira en sucursal Correo Argentino</p>
            <p className="font-bold">
              {sucursal.name} ({sucursal.code})
            </p>
            <p>{sucursal.address}</p>
            <p>
              {sucursal.locality}, {sucursal.province}
            </p>
          </div>
        ) : d ? (
          <div className="mt-[2mm] text-[11pt] leading-snug">
            <p className="font-bold">
              {d.address_name} {d.address_number}
              {d.department ? `, ${d.department}` : ""}
            </p>
            <p>{d.location}</p>
            <p>{d.province}</p>
          </div>
        ) : (
          <p className="mt-[2mm] text-[10pt] font-bold">SIN DIRECCIÓN CARGADA</p>
        )}

        {/* Sin teléfono ni DNI del cliente: la etiqueta la ve cualquiera que
            toque el paquete, y el correo no los necesita para entregar. */}
        <div className="mt-[3mm] flex justify-end">
          {cp && (
            <div className="rounded-[1.5mm] bg-black px-[3mm] py-[1.5mm] text-center text-white">
              <p className="text-[6.5pt] font-bold leading-none">CP</p>
              <p className="text-[18pt] font-black leading-none">{cp}</p>
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------- Frágil ---------------------------------- */}
      {/* Sin decir qué hay adentro: anunciar electrónica en la caja es
          invitar a que se pierda en el camino. */}
      <div className="mt-[3mm] flex items-center justify-center gap-[2mm] bg-black py-[1.5mm] text-white">
        <span className="text-[10pt] font-black tracking-[0.2em]">FRÁGIL</span>
        <span className="text-[7pt]">· Manipular con cuidado</span>
      </div>

      {/* ---------------------------------- Pedido ---------------------------------- */}
      {/* Ocupa el alto que deje la dirección: corta o larga, el código queda
          centrado en el espacio libre. */}
      <div className="flex flex-1 flex-col items-center justify-center py-[2mm] text-center">
        <svg ref={barras} className="max-h-[24mm] max-w-full" />
        <p className="mt-[1mm] text-[10pt] font-bold tracking-widest">PEDIDO {orden.payment_id}</p>
      </div>

      <div className="mt-[2.5mm] flex justify-between border-t-2 border-black pt-[2mm] text-[8pt]">
        <span>
          Bultos: <b>1</b> · Artículos: <b>{articulos}</b>
        </span>
        {(orden.carrier || orden.tracking_number) && (
          <span className="text-right">
            {orden.carrier}
            {orden.tracking_number && <> · <b>{orden.tracking_number}</b></>}
          </span>
        )}
      </div>
    </div>
  );
};

export default EtiquetaEnvio;
