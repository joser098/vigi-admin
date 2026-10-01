# Integración Correo Argentino (API MiCorreo) — PENDIENTE

Estado (2026-10-01): **esperando credenciales**. Ya se envió el formulario a
Correo. Cuando lleguen, retomar desde "Plan".

Doc oficial: `apiMiCorreo.pdf` (versión 8/8/2022, quedó en Downloads del dueño).
Abajo está todo lo necesario para no depender del PDF.

## Objetivo

Cotizar el envío y ofrecer al cliente las dos opciones:
**a domicilio** o **retiro en sucursal** (más barato). Una sola llamada a
`/rates` devuelve las dos.

## API

| Ambiente | Base URL |
|---|---|
| QA | `https://apitest.correoargentino.com.ar/micorreo/v1` |
| Prod | `https://api.correoargentino.com.ar/micorreo/v1` |

Credenciales distintas por ambiente.

### Auth
`POST /token` con HTTP Basic (`user:password`) →
`{ "token": "<JWT>", "expires": "2022-04-26 21:16:20" }`.
Resto de endpoints: `Authorization: Bearer <token>`. Cachear el token hasta
`expires` y renovarlo ante un 401.

### customerId
Todos los endpoints piden `customerId` de la cuenta MiCorreo de la empresa.
Se obtiene una vez con `POST /users/validate` `{ email, password }` →
`{ customerId }`. Guardarlo como config/secret.

### Cotizar: `POST /rates`
```json
{
  "customerId": "0000550137",
  "postalCodeOrigin": "1757",
  "postalCodeDestination": "1704",
  "dimensions": { "weight": 2500, "height": 10, "width": 20, "length": 30 }
}
```
- Sin `deliveredType` devuelve domicilio (`"D"`) y sucursal (`"S"`) juntos.
- **Peso y medidas obligatorios**, enteros: peso en gramos (1–25000),
  alto/ancho/largo en cm (máx 150).
- CP en formato de 4 dígitos.

Respuesta:
```json
{
  "customerId": "0000550997",
  "validTo": "2022-06-07T10:31:27.881-03:00",
  "rates": [
    { "deliveredType": "D", "productType": "CP", "productName": "Paq.ar Clásico", "price": 498.06 },
    { "deliveredType": "S", "productType": "CP", "productName": "Paq.ar Clásico", "price": 398.06 }
  ]
}
```
El precio vence en `validTo`: si se guarda en un pedido, guardar también eso.

### Otros endpoints (fase 2)
- `GET /agencies?customerId=&provinceCode=` — sucursales de una provincia
  (código, dirección, lat/long, horarios). Para que el cliente elija sucursal.
- `POST /shipping/import` — carga el envío en MiCorreo. Requiere `extOrderId`,
  `recipient.name/email`, `shipping.deliveryType` (**ojo: acá es
  `deliveryType`, en `/rates` es `deliveredType`**), `shipping.agency` si es
  sucursal, dirección si es domicilio, `weight`, `declaredValue`, medidas.
  Responde error si la orden ya se importó (sirve de idempotencia).

### Errores
JSON `{ code, message }`. Casi todo error de negocio es **402** con mensaje en
texto libre: mostrar `message` tal cual. 429 → reintentar con backoff.

### Códigos de provincia
A Salta · B Buenos Aires · C CABA · D San Luis · E Entre Ríos · F La Rioja ·
G Sgo. del Estero · H Chaco · J San Juan · K Catamarca · L La Pampa ·
M Mendoza · N Misiones · P Formosa · Q Neuquén · R Río Negro · S Santa Fe ·
T Tucumán · U Chubut · V Tierra del Fuego · W Corrientes · X Córdoba ·
Y Jujuy · Z Santa Cruz

## Restricciones de arquitectura

- **Decidido: la integración se implementa en `vigi-api`**, que es nuestro
  servidor y donde vive el checkout. No va en este panel ni en ningún front
  (las credenciales quedarían expuestas y probablemente no hay CORS).
- Secrets: `MICORREO_BASE_URL`, `MICORREO_USER`, `MICORREO_PASSWORD`,
  `MICORREO_CUSTOMER_ID`, y el CP de origen del depósito.

## Plan

1. Probar en QA con curl: `/token` → `/users/validate` → `/rates`.
2. **Datos de productos** — HECHO (migración 0023 de `vigi-api`, página
   `/envios` y sección "Envío" del detalle de producto). Bulto del producto =
   sus medidas propias si las tiene; si no, el perfil de caja de su categoría.
   Falta, al cotizar: consolidar pedidos con varios ítems en un bulto (sumar
   pesos, elegir caja). Esto sirve igual para Andreani (lo actual) que para
   Correo: la decisión de con cuál se implementa primero quedó abierta.
3. Función `cotizar-envio`: recibe CP destino + ítems, arma el bulto, usa el
   token cacheado, llama a `/rates` y devuelve
   `{ domicilio, sucursal, validTo }`.
4. UI: mostrar las dos opciones y destacar que sucursal es más barato.
5. Fase 2: selector de sucursal (`/agencies`) e importar envíos
   (`/shipping/import`) desde el admin.
