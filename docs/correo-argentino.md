# Integración Correo Argentino (API MiCorreo) — EN CURSO

Estado (2026-10-08): credenciales de **producción** recibidas y cargadas en
`vigi-api/.env`; `/token` probado OK, `customerId` cargado, `/rates` probado OK. Implementado en
`vigi-api`, `vigi-app` y este panel (ver "Plan"); **falta aplicar la migración
0028 y deployar**. Decisiones: solo servicio Clásico; Correo reemplaza a
Andreani; gratis todo en CABA, y fuera de CABA solo sucursal desde $450.000;
el cliente elige la sucursal en el checkout; bulto = caja del perfil de la
categoría (peso del producto si lo tiene); tercera opción "acordar envío" (no
se cobra, se coordina después) para no perder ventas, también como salida si
Correo no cotiza.

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
`{ "token": "<JWT>", "expire": "2026-10-08 16:32:19" }` (dura ~1 h).
**Ojo:** en la práctica el campo es `expire`, no `expires` como dice el PDF.
El servidor cortó una vez una conexión HTTP/2 (`curl` error 92); con
HTTP/1.1 anda bien.
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

**Respuesta real (prod, 2026-10-08)** — difiere del PDF:
- Status **202**, no 200: tratar todo 2xx como éxito.
- Vienen **4 tarifas**: Clásico (`CP`, 2–5 días) y Expreso (`EP`, 1–3 días),
  cada una para `D` y `S`. Traen `deliveryTimeMin`/`deliveryTimeMax` (strings).
- Ejemplo 1 kg, 30×20×10, desde 1406: a 1704 → S/CP $5.428, S/EP $5.969,
  D/CP $8.046, D/EP $8.853. A 5000 → S/CP $6.739, S/EP $9.271, D/CP $9.648,
  D/EP $13.263.

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

1. ~~Probar `/token` → `/rates`~~ — HECHO en prod (el `customerId` lo pasó
   el dueño, no hizo falta `/users/validate`). Ojo: ante ráfagas de pedidos
   Imperva bloquea la IP ~2 minutos (ECONNRESET), y además resetea alguna
   conexión suelta: el cliente reintenta.
2. **Datos de productos** — HECHO (migración 0023 de `vigi-api`, página
   `/envios` y sección "Envío" del detalle de producto). Bulto del producto =
   sus medidas propias si las tiene; si no, el perfil de caja de su categoría.
   Consolidación en bultos: HECHO (`vigi-api/src/services/bulto.js`).
   Se usan las cajas de los perfiles, no las medidas del producto (solo su
   peso, si lo tiene). Perfiles asignados a las 10 categorías el 2026-10-08,
   con medidas estimadas: ajustar con cajas reales en `/envios`.
3. ~~Cotización~~ — HECHO: `services/micorreo.js` + `services/shipping.js`
   en `vigi-api`.
4. ~~UI~~ — HECHO: `vigi-app/src/components/OrderResume.tsx`, con selector de
   sucursal (`GET /api/logistic/agencies`, adelantado de la fase 2).
   El panel muestra forma de entrega y sucursal en el detalle y la etiqueta.
5. "Acordar envío": el cliente escribe por WhatsApp (Kapso, flujo
   `vigi-acordar`) con su número de pedido y se le pasa a una persona.
6. Fase 2: importar envíos (`/shipping/import`) desde el admin, con
   `declaredValue` = total de la orden.
