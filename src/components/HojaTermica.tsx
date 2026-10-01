import type { ReactNode } from "react";

/**
 * Datos de VIGI que van impresos en etiquetas e insertos.
 *
 * La dirección es la de la oficina de Caballito, la misma que figuraba como
 * punto de retiro en el checkout. Si se despacha desde otro lado, se cambia acá.
 */
export const VIGI = {
  nombre: "VIGI",
  direccion: "Figueroa 973, CABA",
  web: "vigi.com.ar",
  instagram: "@vigi.cam_",
};

/**
 * Una hoja de 10×15 cm para la impresora térmica.
 *
 * En pantalla se ve la hoja en su tamaño real con una barra para imprimir; al
 * imprimir solo sale la hoja, sin márgenes. En el diálogo de impresión hay que
 * elegir la térmica, tamaño 100×150 mm y escala 100%.
 */
export const HojaTermica = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <div className="min-h-screen bg-neutral-100 py-6 print:bg-white print:py-0">
    <style>{`
      @page { size: 100mm 150mm; margin: 0; }
      @media print {
        html, body { background: #fff !important; }
        .no-print { display: none !important; }
      }
    `}</style>

    <div className="no-print mx-auto mb-4 flex w-[100mm] items-center justify-between gap-3">
      <p className="text-xs text-neutral-500">{titulo} · 10×15 cm</p>
      <button onClick={() => window.print()} className="btn-primary">
        Imprimir
      </button>
    </div>

    <div className="mx-auto h-[150mm] w-[100mm] overflow-hidden bg-white text-black shadow-lg print:shadow-none">
      {children}
    </div>

    <p className="no-print mx-auto mt-3 w-[100mm] text-[11px] text-neutral-400">
      En el diálogo de impresión: elegí la térmica, tamaño 100×150 mm, márgenes "ninguno" y escala 100%.
    </p>
  </div>
);
