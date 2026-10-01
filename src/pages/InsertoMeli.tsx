import { ASSETS_URL } from "@/lib/supabase";
import { HojaTermica, VIGI } from "@/components/HojaTermica";

// Las marcas oficiales que se venden, con los mismos logos que la grilla del
// home de la tienda (vigi-app: services/const.ts → brands).
const MARCAS = ["Hikvision", "Dahua", "Ezviz", "Imou"];

/**
 * Inserto de marca para los paquetes de MercadoLibre, en la térmica de 10×15.
 *
 * MercadoLibre ya imprime su etiqueta de envío; esto va adentro de la caja.
 * Es de marca y posventa a propósito: MercadoLibre prohíbe invitar a comprar
 * por fuera de la plataforma, así que no lleva teléfono ni "comprá en la web",
 * y la ayuda se pide por la mensajería de la compra. La web va como marca.
 *
 * Es igual para todas las ventas: se imprime un lote y se usa a medida que
 * salen los paquetes.
 */
const InsertoMeli = () => (
  <HojaTermica titulo="Inserto para paquetes de MercadoLibre">
    <div className="flex h-full flex-col items-center p-[6mm] text-center font-sans">
      <img src="/vigi_black.svg" alt="VIGI" className="mt-[3mm] h-[16mm]" />

      <p className="mt-[6mm] text-[17pt] font-black leading-tight">¡Gracias por tu compra!</p>
      <p className="mt-[2mm] text-[9.5pt] leading-snug">
        Tu equipo es nuevo y tiene <b>garantía oficial del fabricante</b> de 6 meses a 2 años, según la marca.
      </p>

      <div className="mt-[5mm] w-full rounded-[2mm] border-2 border-black p-[3.5mm] text-left">
        <p className="text-[9pt] font-black uppercase tracking-wide">¿Necesitás ayuda?</p>
        <ul className="mt-[1.5mm] space-y-[1mm] text-[8.5pt] leading-snug">
          <li>• Revisá el paquete y su contenido al recibirlo.</li>
          <li>• Si algo no funciona o tenés dudas con la instalación, escribinos por la mensajería de tu compra.</li>
          <li>• Te ayudamos también con la garantía.</li>
        </ul>
      </div>

      <p className="mt-[5mm] text-[7.5pt] font-bold uppercase tracking-widest">Trabajamos con marcas oficiales</p>
      <div className="mt-[2.5mm] grid w-full grid-cols-4 items-center gap-[3mm]">
        {MARCAS.map((m) => (
          <img
            key={m}
            src={`${ASSETS_URL}/logos/${m}.png`}
            alt={m}
            className="mx-auto max-h-[8mm] w-full object-contain grayscale contrast-200"
          />
        ))}
      </div>

      <div className="mt-auto w-full border-t-2 border-black pt-[3mm]">
        <p className="text-[16pt] font-black tracking-tight">{VIGI.web}</p>
        <p className="text-[9pt]">Instagram {VIGI.instagram}</p>
        <p className="mt-[1mm] text-[7.5pt]">Seguridad para tu casa y tu negocio</p>
      </div>
    </div>
  </HojaTermica>
);

export default InsertoMeli;
