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

## Cupones

El contador de usos (`coupons.redemptions`) lo mantiene un trigger a partir de
`coupon_redemptions`, y la base **no deja escribirlo desde el panel**: si se
pudiera, el límite de usos sería decorativo. Los canjes tampoco se escriben
desde acá — los crea la API cuando un pago se aprueba.

Un cupón que ya se usó no se puede borrar desde la UI: borrarlo se llevaría
puesto el historial que explica los descuentos de órdenes viejas. Para sacarlo
de circulación se apaga (`is_active`), que corta en el acto.

El código es `citext`: `verano25` y `VERANO25` son el mismo cupón.
