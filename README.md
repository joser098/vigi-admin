# VIGI Admin

Panel interno. React + Vite + Tailwind, hablando directo con Postgres vía
`supabase-js`. **No tiene backend propio.**

```bash
cp .env.example .env    # completar VITE_SUPABASE_ANON_KEY
npm install
npm run dev             # http://localhost:4500
```

## Cómo funciona la seguridad

No hay servidor que valide nada: **toda la autorización vive en la base**, en
`db/migrations/0006_admin_rls.sql` del repo `vigi-api`. Son dos capas:

| Capa | Qué decide |
|---|---|
| **RLS** | qué filas ve cada rol — todo pasa por `is_admin()`, que exige que el email del token esté en `admin_users` y activo |
| **GRANT por columna** | qué columnas se pueden escribir |

Consecuencias que conviene tener presentes:

- La `anon key` es pública por diseño. Sin sesión válida no devuelve una sola fila.
- Un admin **no puede escribir `cost` ni `price`**: Postgres lo rechaza con
  `permission denied`. El costo lo pone el importador y el precio lo calcula el
  trigger `products_set_price`.
- Un admin no puede crear ni borrar productos, ni leer carritos, favoritos o
  hashes de verificación.
- Cada admin ve solo su propia fila de `admin_users`: la whitelist no se expone.
- Poner `is_active = false` en `admin_users` corta el acceso en el acto.

**El frontend nunca es la barrera.** Si algo de esto se rompiera en la UI, la
base lo seguiría rechazando.

## Dar acceso a alguien

```sql
insert into admin_users (email, name) values ('persona@vigi.cam', 'Nombre');
```

Y en Supabase → Authentication → Providers, tener habilitado **Email** con magic
link. Conviene además desactivar el registro abierto: no hace falta que nadie
pueda crearse cuenta, porque igual no pasaría la whitelist, pero evita ruido.

## Secciones

- **Dashboard** — ventas del mes, ticket promedio, histórico, más vendidos y
  estado del catálogo. Lee de las vistas `admin_*`, que tienen
  `security_invoker` para que respeten RLS.
- **Órdenes** — listado con filtro por estado y búsqueda; el detalle muestra
  productos, cliente, dirección y datos del pago, y permite cambiar el estado.
- **Productos** — listado de ~700 con búsqueda instantánea (se traen una vez y
  se filtra en memoria) y filtro de "solo sin foto".
- **Detalle de producto** — costo, margen, precio manual, descuento,
  visibilidad e imagen. Muestra el **margen real** y la ganancia en pesos,
  recalculados en vivo mientras editás.
- **Cupones** — códigos de descuento por porcentaje o monto fijo, con compra
  mínima, tope en pesos, vigencia y límites de uso (totales y por cliente). El
  detalle lista los canjes con cliente y monto.
- **Email** — lista de contactos, armador de campañas con plantillas de
  producto, y el envío por tandas contra Resend.

## Email

Quien manda es la Edge Function `marketing-send` de `vigi-api`, nunca el
navegador: la API key de Resend no puede estar en el bundle. El panel arma la
campaña, muestra la preview y aprieta el botón.

**Armar con productos.** Se eligen hasta 8 productos activos con foto, se elige
una de las tres plantillas (`Grilla`, `Destacado`, `Ofertas`) y sale el HTML
listo. Las plantillas viven en `src/lib/emailTemplates.ts`; el pie con envío,
garantía, despacho y medios de pago está ahí y no en cada campaña, con los datos
reales de la tienda. El precio tachado sale de `has_promotion` y `discount` del
producto: si no tiene descuento cargado, no aparece — un "antes" inventado es la
clase de error que hay que deshacer después.

**Envío por tandas.** El plan gratuito de Resend son 100 mails por día, y los
comparte con los transaccionales de la API. Por eso la lista no sale de una: la
tanda por defecto son 85, la pantalla muestra cuántos ya la recibieron y cuántos
faltan, y al día siguiente se aprieta de nuevo. Nadie la recibe dos veces —cada
envío deja una fila en `marketing_sends` y la tanda siguiente los saltea—, y la
campaña queda en `sending` hasta que no queda nadie.

**El remitente.** El campo `from_name` es el nombre que se ve en la bandeja. Sin
él el correo llega firmado con lo que dice la dirección (`marketing`), que no le
dice nada a nadie.

**Cómo se sabe si el mail vendió.** Cada campaña se cuelga de un **cupón activo**
(se elige de una lista, no se escribe: el descuento que promete el mail es el que
va a aplicar el carrito). El código va grande en el mail y con la instrucción de
dónde ponerlo, porque el carrito **no lo acepta por URL** — se tipea a mano en
`OrderResume.tsx`. Eso es justamente lo que lo hace medible: cada fila de
`coupon_redemptions` con ese código es una venta que empezó en el mail, con su
`order_id` y su monto, y ya se ve hoy en **Cupones**. Subestima —quien compra sin
usar el código no cuenta— pero es plata real y no depende de ningún tag.

Todos los links llevan además `utm_source=newsletter&utm_medium=email` más
`utm_campaign` (la etiqueta de la campaña) y `utm_content` (qué link: el modelo
del producto, el botón, el logo o el pie). **Hoy no los lee nadie**: en
`vigi-app` hay GTM y Google Ads pero no GA4, y `orders` no guarda el origen. Van
igual porque no cuestan nada y el día que se conecte GA4 —o se guarde el origen
en `orders`— los mails viejos ya vienen etiquetados. El link de baja y el
`mailto` quedan sin UTM a propósito.

Contactos y envíos se leen con `traerTodo` de `lib/supabase.ts`: PostgREST corta
en 1000 filas por respuesta y no avisa, así que con más de mil contactos una
consulta común devuelve 1000 y parece completa.

## Cupones

El contador de usos (`coupons.redemptions`) lo mantiene un trigger a partir de
`coupon_redemptions`, y la base **no deja escribirlo desde el panel**: si se
pudiera, el límite de usos sería decorativo. Los canjes tampoco se escriben
desde acá — los crea la API cuando un pago se aprueba.

Un cupón que ya se usó no se puede borrar desde la UI: borrarlo se llevaría
puesto el historial que explica los descuentos de órdenes viejas. Para sacarlo
de circulación se apaga (`is_active`), que corta en el acto.

El código es `citext`: `verano25` y `VERANO25` son el mismo cupón.
