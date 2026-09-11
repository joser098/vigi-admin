import { money, date } from "@/lib/format";
import type { Product, Coupon } from "@/lib/types";

/**
 * Plantillas de email para promocionar productos.
 *
 * Se elige un puñado de productos en el panel, se elige plantilla y sale el
 * HTML listo para pegar en la campaña. La idea es no volver a escribir HTML de
 * mail a mano: es tabla sobre tabla y se rompe distinto en cada cliente.
 *
 * Tres reglas que explican por qué el código se ve así:
 *
 *   - **Todo con `<table>` y estilos inline.** Gmail borra el `<style>` de
 *     `<head>` en varias de sus versiones y ningún cliente de correo soporta
 *     flex ni grid. Lo único que va en `<style>` es la consulta de ancho para
 *     que la grilla apile en el celular: si se pierde, el mail sigue siendo
 *     legible, solo que a dos columnas angostas.
 *   - **Los números salen del producto, no del texto.** El precio tachado
 *     aparece solo si el producto tiene descuento de verdad
 *     (`has_promotion` y `discount >= 1`). Inventar un "antes" es la clase de
 *     error que hay que deshacer después.
 *   - **Los datos del pie están acá y no en cada campaña.** Envío, garantía,
 *     despacho y medios de pago son los de la tienda, verificados contra
 *     `vigi-app/src/services/const.ts` y `vigi-api/src/services/shipping.js`.
 *     Si cambian allá, se cambian acá y todas las campañas nuevas los toman.
 */

const SITIO = "https://vigi.com.ar";

// El logo blanco, que es el que va sobre violeta. Vive en `public/` de la
// tienda: una URL absoluta y estable, que es lo único que sirve en un mail.
const LOGO = SITIO + "/2.png";

const C = {
  primario: "#1e053f",
  tinta: "#241a33",
  suave: "#6b6478",
  linea: "#e7e4ed",
  panel: "#f4f2f8",
  fondo: "#f5f5f7",
  oferta: "#b9711a",
  ofertaSuave: "#fdf3e3",
};

const FUENTE =
  "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

/**
 * Los datos duros del pie.
 *
 * Envío: CABA no cotiza nunca y el resto del país entra gratis desde
 * $450.000 (`FREE_SHIPPING_MIN_PURCHASE`). Contacto: por mail y no por
 * WhatsApp, porque `SHOW_WHATSAPP` está en `false` y el sitio entero cae al
 * mail — mandar a la gente a un canal que no se está atendiendo es peor que
 * no ofrecerlo.
 */
const DATOS: Array<[string, string]> = [
  ["Envío gratis", "En CABA siempre. Al resto del país, desde $450.000 de compra."],
  ["Garantía oficial", "De 6 a 24 meses según la marca."],
  ["Despacho", "Comprás antes de las 17:00 y sale el mismo día."],
  ["Pago", "Tarjeta de crédito o débito, por Mercado Pago."],
];

const CONTACTO = "contacto@vigi.com.ar";

export type ProductoMail = Pick<
  Product,
  "model" | "title" | "thumbnail" | "price" | "effective_price" | "discount" | "has_promotion"
>;

export type PlantillaId = "grilla" | "destacado" | "ofertas";

/**
 * El cupón de la campaña, tal como está en la base.
 *
 * Se elige de la tabla `coupons` y no se escribe a mano: el código, el
 * descuento, la compra mínima y el vencimiento que dice el mail son los que va
 * a aplicar el carrito. Un mail que promete "20% off" contra un cupón que da
 * 10 es una promesa que se rompe en el checkout.
 */
export type CuponMail = Pick<
  Coupon,
  "code" | "kind" | "value" | "min_purchase" | "max_discount" | "ends_at"
>;

export type Ajustes = {
  preheader: string;
  titulo: string;
  bajada: string;
  cta: string;
  /** Etiqueta de la campaña para los UTM. Ver `conUtm`. */
  utm: string;
  /** Sin cupón, el mail sale igual y no se dibuja el bloque. */
  cupon: CuponMail | null;
};

/** Texto libre → etiqueta usable en una URL. */
export const slug = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mail";

/**
 * Le pega los UTM a un link del mail.
 *
 * Sirven para dos cosas distintas y conviene no confundirlas:
 *
 *   - `utm_campaign` dice **qué campaña** trajo a la persona.
 *   - `utm_content` dice **qué link** apretó: el modelo del producto, el botón
 *     grande, el logo o el pie. Es lo que contesta "¿miran la tapa o van
 *     directo al último producto?".
 *
 * Hoy la tienda no los lee —no hay GA4 ni captura de UTM en `vigi-app`—, así
 * que quien contesta "¿vendió el mail?" es el cupón. Los UTM van igual porque
 * quedan en el `dataLayer` de GTM, no cuestan nada, y el día que se conecte
 * GA4 o se guarde el origen en `orders` los mails viejos ya vienen etiquetados.
 */
const conUtm = (url: string, a: Ajustes, content: string) => {
  const p = new URLSearchParams({
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: slug(a.utm),
    utm_content: slug(content),
  });

  return `${url}${url.includes("?") ? "&" : "?"}${p.toString()}`;
};

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const enOferta = (p: ProductoMail) =>
  p.has_promotion && p.discount >= 1 && p.effective_price < p.price;

const link = (p: ProductoMail, a: Ajustes) =>
  conUtm(`${SITIO}/product/${encodeURIComponent(p.model)}`, a, p.model);

/**
 * El bloque del cupón.
 *
 * Es lo que hace medible la campaña: el carrito no acepta el código por URL
 * —se tipea a mano en el resumen del pedido, `OrderResume.tsx`—, así que cada
 * fila de `coupon_redemptions` con ese código es una venta que empezó en el
 * mail, con su `order_id` y su monto. Por eso el código va grande y con la
 * instrucción de dónde ponerlo: si no lo tipean, no hay atribución.
 *
 * Todo lo que dice sale de la fila del cupón, no de un texto escrito a mano.
 */
const bloqueCupon = (a: Ajustes) => {
  const c = a.cupon;
  if (!c) return "";

  const cuanto =
    c.kind === "percentage" ? `${c.value}% de descuento` : `${money(c.value)} de descuento`;

  // El orden importa para que se lea como una frase: primero desde cuánto
  // aplica, después el tope, y al final hasta cuándo.
  const condiciones = [
    c.min_purchase > 0 ? `en compras desde ${money(c.min_purchase)}` : "",
    c.kind === "percentage" && c.max_discount ? `con un tope de ${money(c.max_discount)}` : "",
    c.ends_at ? `válido hasta el ${date(c.ends_at)}` : "",
  ].filter(Boolean);

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:22px">
  <tr>
    <td align="center" style="padding:18px 16px;border:2px dashed ${C.linea};border-radius:14px;background:${C.panel}">
      <p style="margin:0 0 8px;font-family:${FUENTE};font-size:13px;font-weight:600;color:${C.suave}">
        ${esc(cuanto)} con este código
      </p>
      <p style="margin:0 0 8px;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;letter-spacing:.12em;color:${C.primario}">
        ${esc(c.code.toUpperCase())}
      </p>
      <p style="margin:0;font-family:${FUENTE};font-size:12px;line-height:1.5;color:${C.suave}">
        Lo ponés en el carrito, antes de pagar.${
          condiciones.length ? `<br />${esc(condiciones.join(" · "))}` : ""
        }
      </p>
    </td>
  </tr>
</table>`;
};

/**
 * La foto del producto.
 *
 * Con `anchoPx` sale a un ancho fijo; sin él, al 100% de la celda. Tiene que
 * ser el ancho de la **imagen** y no el de una tabla que la envuelva: una
 * tabla de 300 px con un `<img width="100%">` adentro es una definición
 * circular, y el navegador la resuelve con el tamaño real del archivo — que
 * en las fotos de la tienda son más de 500 px de alto.
 *
 * Una imagen que no carga deja un hueco raro; un fondo del color del panel
 * hace que el hueco parezca parte del diseño.
 */
const foto = (p: ProductoMail, alto: number, anchoPx?: number) => {
  const ancho = anchoPx ? `${anchoPx}` : "100%";
  const css = anchoPx ? `width:${anchoPx}px` : "width:100%";

  return p.thumbnail
    ? `<img src="${esc(p.thumbnail)}" width="${ancho}" alt="${esc(
        p.title
      )}" style="display:block;${css};max-width:100%;height:auto;border:0;border-radius:10px;background:${C.panel}" />`
    : `<div style="${css};max-width:100%;height:${alto}px;border-radius:10px;background:${C.panel}"></div>`;
};

const precio = (p: ProductoMail, tamano: number) => {
  const actual = `<span style="font-family:${FUENTE};font-size:${tamano}px;font-weight:700;color:${C.primario}">${money(p.effective_price)}</span>`;

  if (!enOferta(p)) return actual;

  return `${actual} <span style="font-family:${FUENTE};font-size:${Math.round(
    tamano * 0.8
  )}px;color:${C.suave};text-decoration:line-through">${money(p.price)}</span>`;
};

const pastilla = (p: ProductoMail) =>
  enOferta(p)
    ? `<span style="display:inline-block;margin-bottom:8px;padding:3px 8px;border-radius:999px;background:${C.ofertaSuave};font-family:${FUENTE};font-size:11px;font-weight:700;color:${C.oferta}">${p.discount}% OFF</span>`
    : "";

/** Botón a prueba de Outlook: el color lo pinta la celda, no el `<a>`. */
const boton = (texto: string, href: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
  <tr>
    <td align="center" bgcolor="${C.primario}" style="border-radius:10px">
      <a href="${href}" style="display:block;padding:14px 28px;font-family:${FUENTE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(
        texto
      )}</a>
    </td>
  </tr>
</table>`;

/** Tarjeta de la grilla: foto arriba, título y precio abajo. */
const tarjeta = (p: ProductoMail, a: Ajustes) => `
<a href="${link(p, a)}" style="text-decoration:none;color:inherit">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${C.linea};border-radius:14px">
    <tr>
      <td style="padding:14px 14px 0">${foto(p, 200)}</td>
    </tr>
    <tr>
      <td style="padding:14px">
        ${pastilla(p)}
        <p style="margin:0 0 8px;font-family:${FUENTE};font-size:14px;line-height:1.35;font-weight:600;color:${C.tinta}">${esc(
          p.title
        )}</p>
        <p style="margin:0">${precio(p, 18)}</p>
      </td>
    </tr>
  </table>
</a>`;

/** Fila compacta: foto a la izquierda, texto a la derecha. No apila nunca. */
const fila = (p: ProductoMail, a: Ajustes) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${C.linea};border-radius:14px;margin-bottom:12px">
  <tr>
    <td width="120" valign="middle" style="padding:12px">
      <a href="${link(p, a)}" style="display:block">${foto(p, 96, 96)}</a>
    </td>
    <td valign="middle" style="padding:12px 16px 12px 0">
      ${pastilla(p)}
      <p style="margin:0 0 6px;font-family:${FUENTE};font-size:15px;line-height:1.35;font-weight:600;color:${C.tinta}">
        <a href="${link(p, a)}" style="color:${C.tinta};text-decoration:none">${esc(p.title)}</a>
      </p>
      <p style="margin:0 0 10px">${precio(p, 17)}</p>
      <a href="${link(p, a)}" style="font-family:${FUENTE};font-size:13px;font-weight:600;color:${C.primario};text-decoration:underline">Ver el detalle</a>
    </td>
  </tr>
</table>`;

/** Arma la grilla de a dos. En el celular apila por la consulta de ancho. */
const grilla = (productos: ProductoMail[], a: Ajustes) => {
  const pares: ProductoMail[][] = [];
  for (let i = 0; i < productos.length; i += 2) pares.push(productos.slice(i, i + 2));

  return pares
    .map(
      (par) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:16px">
  <tr>
    <td class="col" width="50%" valign="top" style="padding-right:8px">${tarjeta(par[0], a)}</td>
    <td class="col" width="50%" valign="top" style="padding-left:8px">${
      par[1] ? tarjeta(par[1], a) : ""
    }</td>
  </tr>
</table>`
    )
    .join("");
};

const pie = (a: Ajustes) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;background:#ffffff;border:1px solid ${C.linea};border-radius:14px">
  <tr>
    <td style="padding:20px 22px">
      <p style="margin:0 0 14px;font-family:${FUENTE};font-size:15px;font-weight:700;color:${C.primario}">
        El equipo es tuyo. Sin abono mensual.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${DATOS.map(
          ([que, detalle]) => `
        <tr>
          <td width="120" valign="top" style="padding:5px 10px 5px 0;font-family:${FUENTE};font-size:13px;font-weight:600;color:${C.tinta}">${que}</td>
          <td valign="top" style="padding:5px 0;font-family:${FUENTE};font-size:13px;line-height:1.5;color:${C.suave}">${detalle}</td>
        </tr>`
        ).join("")}
      </table>
    </td>
  </tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td align="center" style="padding:24px 16px 8px;font-family:${FUENTE};font-size:12px;line-height:1.7;color:${C.suave}">
      ¿Dudas antes de comprar? Escribinos a
      <a href="mailto:${CONTACTO}" style="color:${C.suave}">${CONTACTO}</a>.<br />
      <a href="${conUtm(SITIO, a, "pie")}" style="color:${C.suave}">vigi.com.ar</a>
      &nbsp;·&nbsp;
      <a href="{{unsubscribe}}" style="color:${C.suave};text-decoration:underline">Darme de baja</a>
    </td>
  </tr>
</table>`;

/**
 * El armazón común: doctype, cabecera violeta y ancho de 600 px.
 *
 * El bloque oculto de arriba es el texto de vista previa, el que la bandeja
 * muestra al lado del asunto. Si no se pone, ahí aparece lo primero que
 * encuentre el cliente de correo, que suele ser el alt del logo.
 */
const armazon = (a: Ajustes, cuerpo: string) => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(a.titulo)}</title>
<style>
  @media only screen and (max-width:600px) {
    .col { display:block !important; width:100% !important; max-width:100% !important; padding:0 0 16px 0 !important; }
    .marco { padding:16px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.fondo}">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(
  a.preheader
)}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.fondo}">
  <tr>
    <td align="center" class="marco" style="padding:24px 16px 40px">

      <!-- width="600" es el atributo que mira Outlook de escritorio, que
           ignora las consultas de ancho y siempre dibuja a lo ancho. El
           width:100%/max-width del style es para todo lo demás: con 600px
           fijos, un teléfono de 400 se lleva una barra de scroll horizontal. -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">
        <tr>
          <td align="center" bgcolor="${C.primario}" style="padding:26px 24px;border-radius:16px 16px 0 0">
            <a href="${conUtm(SITIO, a, "logo")}"><img src="${LOGO}" width="104" alt="VIGI" style="display:block;width:104px;height:auto;border:0" /></a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 8px;background:#ffffff;border-left:1px solid ${C.linea};border-right:1px solid ${C.linea}">
            <h1 style="margin:0 0 10px;font-family:${FUENTE};font-size:26px;line-height:1.2;font-weight:700;color:${C.primario}">${esc(
              a.titulo
            )}</h1>
            <p style="margin:0;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${C.suave}">${esc(
              a.bajada
            )}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 24px 28px;background:#ffffff;border:1px solid ${C.linea};border-top:0;border-radius:0 0 16px 16px">
            ${bloqueCupon(a)}
            ${cuerpo}
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">
        <tr><td>${pie(a)}</td></tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;

// ---------------------------------------------------------------------------
// Las tres plantillas
// ---------------------------------------------------------------------------

export const PLANTILLAS: Record<
  PlantillaId,
  {
    nombre: string;
    descripcion: string;
    ideal: string;
    sugerido: Ajustes;
    armar: (productos: ProductoMail[], ajustes: Ajustes) => string;
  }
> = {
  grilla: {
    nombre: "Grilla",
    descripcion: "Dos columnas de tarjetas, todas del mismo tamaño.",
    ideal: "4 a 6 productos que compiten de igual a igual. El clásico de novedades.",
    sugerido: {
      preheader: "Cámaras que comprás una vez y son tuyas.",
      titulo: "Nuevas cámaras en Vigi",
      bajada:
        "Elegís, la comprás y es tuya. Sin abono, sin contrato y sin que nadie te la apague si dejás de pagar.",
      cta: "Ver todo el catálogo",
      utm: "novedades",
      cupon: null,
    },
    armar: (productos, a) =>
      armazon(
        a,
        `
${grilla(productos, a)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td align="center" style="padding-top:12px">${boton(a.cta, conUtm(SITIO, a, "cta"))}</td></tr>
</table>`
      ),
  },

  destacado: {
    nombre: "Destacado",
    descripcion: "El primero grande y arriba, el resto como filas debajo.",
    ideal: "Cuando hay una cámara que querés vender y las otras son el acompañamiento.",
    sugerido: {
      preheader: "La cámara que se lleva la mayoría de las consultas.",
      titulo: "La que más nos piden",
      bajada:
        "La instalás vos, se conecta al wifi y la mirás desde el teléfono. Es tuya desde el día uno.",
      cta: "Quiero verla",
      utm: "destacado",
      cupon: null,
    },
    armar: (productos, a) => {
      const [primero, ...resto] = productos;

      return armazon(
        a,
        `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${C.linea};border-radius:14px">
  <tr>
    <td align="center" style="padding:18px 18px 0">
      <!-- Acotada a 300 px y no al ancho completo: las fotos de la tienda son
           verticales, y a 560 px la cámara ocupa una pantalla entera y el
           precio queda debajo del pliegue. -->
      ${foto(primero, 300, 300)}
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:18px">
      ${pastilla(primero)}
      <p style="margin:0 0 10px;font-family:${FUENTE};font-size:19px;line-height:1.3;font-weight:700;color:${C.tinta}">${esc(
        primero.title
      )}</p>
      <p style="margin:0 0 18px">${precio(primero, 24)}</p>
      ${boton(a.cta, link(primero, a))}
    </td>
  </tr>
</table>

${
  resto.length
    ? `<p style="margin:28px 0 14px;font-family:${FUENTE};font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.suave}">También te puede servir</p>
${resto.map((r) => fila(r, a)).join("")}`
    : ""
}`
      );
    },
  },

  ofertas: {
    nombre: "Ofertas",
    descripcion: "Filas con el precio grande y el porcentaje de descuento.",
    ideal: "Productos con descuento cargado. El precio es el argumento, no el texto.",
    sugerido: {
      preheader: "Precios de esta semana, mientras dure el stock.",
      titulo: "Bajamos estos precios",
      bajada:
        "Los precios de abajo son los que vas a ver en la tienda. Con inflación cambian seguido, así que valen los de hoy.",
      cta: "Ver todas las ofertas",
      utm: "ofertas",
      cupon: null,
    },
    armar: (productos, a) =>
      armazon(
        a,
        `
${productos.map((x) => fila(x, a)).join("")}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td align="center" style="padding-top:16px">${boton(a.cta, conUtm(SITIO, a, "cta"))}</td></tr>
</table>`
      ),
  },
};

export const ORDEN_PLANTILLAS: PlantillaId[] = ["grilla", "destacado", "ofertas"];
