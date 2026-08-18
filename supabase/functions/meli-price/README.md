# Precio de referencia de MercadoLibre

Trae la publicación nueva más barata de un vendedor con reputación para un
producto, y la guarda en `products`. Se dispara desde el detalle del producto
en el admin, de a uno y a pedido.

## Por qué hay una Edge Function y no una llamada desde el navegador

Desde 2024 MercadoLibre no permite consultar la API sin credenciales:
`GET /sites/MLA/search` responde **403 forbidden** de forma anónima. Hace falta
un token, y el `client_secret` no puede viajar al cliente.

Además, MercadoLibre **no soporta `client_credentials`**. Los únicos grants son
`authorization_code` y `refresh_token`, y **cada refresh devuelve un
`refresh_token` nuevo que invalida al anterior**. Por eso los tokens viven en la
tabla `meli_credentials` y no en variables de entorno: rotan, y si no se
persiste la rotación la integración se corta sola a las pocas horas.

## Puesta en marcha (una sola vez)

### 1. Aplicar la migración

`vigi-api/db/migrations/0009_meli_reference_price.sql` agrega las columnas
`meli_*` a `products` y crea `meli_credentials`.

### 2. Crear la aplicación en MercadoLibre

En https://developers.mercadolibre.com.ar → *Mis aplicaciones* → crear una.

- **Redirect URI**: cualquier URL tuya que puedas abrir; solo se usa para
  capturar el `code` del paso 3. Sirve `https://vigi.cam/`.
- Anotá el **App ID** (`client_id`) y la **Clave secreta** (`client_secret`).

### 3. Conseguir el primer `refresh_token`

Abrí esta URL en el navegador, logueado con la cuenta de MercadoLibre que
quieras usar, y autorizá:

```
https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=TU_CLIENT_ID&redirect_uri=TU_REDIRECT_URI
```

Te va a redirigir con `?code=TG-xxxxx` en la URL. Ese código **dura pocos
minutos y se usa una sola vez**. Canjealo enseguida:

```bash
curl -X POST https://api.mercadolibre.com/oauth/token \
  -H 'accept: application/json' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d grant_type=authorization_code \
  -d client_id=TU_CLIENT_ID \
  -d client_secret=TU_CLIENT_SECRET \
  -d code=TG-xxxxx \
  -d redirect_uri=TU_REDIRECT_URI
```

De la respuesta te interesa `refresh_token`. Guardalo:

```sql
insert into meli_credentials (id, refresh_token)
values (true, 'TG-refresh-que-te-devolvio')
on conflict (id) do update set refresh_token = excluded.refresh_token,
                               access_token  = null,
                               expires_at    = null,
                               updated_at    = now();
```

No hace falta guardar el `access_token`: la function lo renueva sola en la
primera llamada.

### 4. Secretos y deploy

```bash
supabase secrets set MELI_CLIENT_ID=... MELI_CLIENT_SECRET=...
supabase functions deploy meli-price
```

La function usa además `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY`, que Supabase inyecta sola.

## Qué precio elige

De los primeros 50 resultados descarta todo lo que no sea `condition: new`, y
de lo que queda se queda con el más barato **de tienda oficial o vendedor con
reputación** (MercadoLíder en cualquier nivel, o verde en la escala de colores).

El mínimo a secas no sirve como referencia: los primeros puestos por precio en
MercadoLibre suelen ser repuestos, usados o publicaciones sueltas. Contra ese
número no competimos.

Si ningún resultado pasa el filtro, guarda `meli_price` en `null` pero sí la
fecha de consulta, para que en el admin se distinga "buscamos y no había" de
"nunca lo buscamos".

## Pendiente de verificar

`pickBest()` lee `condition`, `price`, `official_store_id` y
`seller.seller_reputation` según la respuesta documentada de
`/sites/{site}/search`. **No se pudo confirmar contra una respuesta real**
porque todavía no hay credenciales. Está escrito a la defensiva —lo que no
viene se descarta en lugar de romper— pero conviene mirar el primer resultado
real y ajustar los campos si hiciera falta.
