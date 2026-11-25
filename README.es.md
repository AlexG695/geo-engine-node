# 📦 Geo-Engine Node.js & TypeScript SDK

[![NPM Version](https://img.shields.io/npm/v/geo-engine-node?style=flat-square&color=blue)](https://www.npmjs.com/package/geo-engine-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Vitest%20%2B%20node%3Atest-green.svg)](https://vitest.dev/)

> *Read this in English: [Readme.md](./Readme.md)*

Cliente oficial en **Node.js & TypeScript** para la plataforma **Geo-Engine** (`v2.1.0`).  
Diseñado con tipado estricto en TypeScript, cero dependencias en runtime e integración del lado del servidor en Node.js `>=18`.

---

## ✨ Características

- 📍 **Ingesta de Telemetría:** Envío de coordenadas por HTTP REST (`sendLocation`) y cola en segundo plano `AsyncIngester`.
- 🗺️ **Módulo Spatial:** Evaluación punto-en-polígono (geocerca individual y validación general contra todas las geocercas activas) más constructor fluido `client.spatial.check(lat, lng)`.
- 👥 **Módulo Users:** Gestión de miembros de la organización, roles e invitaciones por correo (`client.users`).
- 🛡️ **Reglas y Evaluación GeoIdentity:** CRUD de reglas (`client.geoIdentity`) y evaluación de decisiones en servidor mediante `client.identity.evaluate(...)` y `geo-engine-node/identity` (`identityGuard`).
- 🚧 **Gestión de Geocercas:** Creación y normalización automática de polígonos GeoJSON respaldados por PostGIS (`createGeofence`).
- 📦 **Dual Package (ESM & CommonJS):** Compatible con `import` nativo y `require()`, empaquetado con `tsup` y definiciones `.d.ts` / `.d.cts`.
- ⚡ **Cero dependencias en runtime:** Construido sobre APIs estándar de Node.js (`fetch`, `node:crypto`, `node:timers`, `AbortController`) para entornos de servidor Node.js `>=18`.

> **Nota de Runtime:** El SDK importa `node:crypto` y `node:timers`, por lo que está pensado para **servidores Node.js** (no es compatible con navegadores ni entornos edge sin capa de compatibilidad de Node). La `apiKey` secreta se almacena en un campo privado `#` y no se expone en `client.options`, `JSON.stringify` ni `util.inspect`.

---

## 🚀 Instalación

```bash
npm install geo-engine-node
```

O usando Yarn / PNPM / Bun:

```bash
pnpm add geo-engine-node
# o
bun add geo-engine-node
```

---

## ⚡ Inicio Rápido

### TypeScript / ES Modules (Recomendado)

```ts
import GeoEngine from 'geo-engine-node';

// Inicializa con tu clave secreta de API
const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

try {
  await client.sendLocation('truck-01', 19.4326, -99.1332);
  console.log('✅ Coordenada enviada con éxito');
} catch (error) {
  console.error('❌ Error al enviar ubicación:', error);
} finally {
  client.close();
}
```

### CommonJS

```js
const GeoEngine = require('geo-engine-node');

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

client.sendLocation('scooter-09', 19.4326, -99.1332)
  .then(() => console.log('Ubicación registrada'))
  .catch((err) => console.error(err));
```

---

## 🛡️ Evaluación GeoIdentity en Tiempo de Ejecución (`/v1/evaluate` e `identityGuard`)

> [!IMPORTANT]
> **Solo servidor y llave secreta:** `POST /v1/evaluate` autentica únicamente con `Authorization: Bearer <llave_secreta>` y **no** admite CORS desde navegadores. Nunca expongas la API key ni importes `geo-engine-node/identity` en código de navegador (si `window` está definido, el módulo lanza un error inmediato).

### Evaluación Directa (`client.identity.evaluate`)

```ts
import GeoEngine from 'geo-engine-node';
import { IdentityTransientError, IdentityIntegrationError, isTransient } from 'geo-engine-node/identity';

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

try {
  const decision = await client.identity.evaluate({
    scope: 'login',
    subject: { user_id: 'user_2abc123', roles: ['admin'], device_id: 'dev_9f8e7d' },
    context: {
      ip: '203.0.113.42',
      location: { lat: 28.6353, lng: -106.0889, accuracy_m: 25, source: 'device' },
    },
  });

  if (decision.decision === 'BLOCK') {
    // Bloquear acceso
  } else if (decision.decision === 'CHALLENGE') {
    // Solicitar verificación adicional (step-up)
  }
} catch (err) {
  if (isTransient(err)) {
    // Red, timeout, 5xx o 429 tras el plazo de 500ms y un reintento
  } else if (err instanceof IdentityIntegrationError) {
    // 400, 401, 403 de borde, 404, 422 o respuesta inesperada (NO aplicar failOpen)
  }
}
```

### Middleware Express / Connect (`identityGuard`)

```ts
import GeoEngine from 'geo-engine-node';
import { identityGuard } from 'geo-engine-node/identity';

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

app.post(
  '/login',
  identityGuard({
    client,
    scope: 'login',
    failOpen: false, // OBLIGATORIO: true permite ante fallo transitorio, false bloquea (403)
    getSubject: (req) => ({ user_id: req.body.userId, device_id: req.headers['x-device-id'] as string }),
    getContext: (req) => ({
      ip: req.ip,
      location: req.body.location, // Si falta y el scope tiene reglas geográficas, el motor puede bloquear con `location_missing`
    }),
    onChallenge: async (decision, _req, res) => {
      res.status(403).json({ error: 'challenge_required', hint: decision.challenge?.hint ?? 'step_up' });
    },
    onIntegrationError: (err) => {
      console.error('Error de integración GeoIdentity:', err);
    },
  }),
  loginHandler
);
```

- **`failOpen` (obligatorio, sin valor por defecto):** aplica **solo** ante errores transitorios (`timeout`, `network`, `server_error`, `rate_limited`) o un valor de `decision` desconocido (`unknown_decision`). En ese caso entrega a `onDecision` una decisión sintética con `fallback: true`, `fallback_reason` y `meta.source = 'sdk_fallback'`.
- **Errores de integración nunca aplican `failOpen`:** `400`, `401`, `403` (incluido `403` de borde sin `problem+json`), `404`, `422`, parámetros locales inválidos o respuestas con forma inesperada llaman a `onIntegrationError` y responden `500` (`{ error: 'internal_error' }`).
- **`CHALLENGE`:** llama a `onChallenge` si se configura; si falta, responde `403` con `{ error: 'challenge_required', hint: 'step_up' }` y nunca llama a `next()`.
- **`context.location`:** si el scope evalúa condiciones geográficas y no se envía `location`, `/v1/evaluate` responde HTTP `200` con la señal `location_missing` (puede bloquear como decisión normal, no como error).
- **Plazo y reintentos:** `evaluate` aplica un plazo total por defecto de `500 ms` (`identityTimeoutMs` o `timeoutMs` por llamada) y como máximo 1 reintento con jitter ante fallos transitorios (respetando `Retry-After` si cabe en el plazo restante), reutilizando el mismo `X-Request-Id`.

---

## 🗺️ Módulo Spatial & Validación de Puntos

```ts
import GeoEngine, { GeofenceNotFoundError } from 'geo-engine-node';

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

try {
  const res = await client.spatial.validatePoint('geofence_123', 19.4326, -99.1332);

  if (res.isInside()) {
    console.log(`✅ El dispositivo está dentro de ${res.geofenceName} (${res.geofenceId})`);
  } else {
    console.log('⚠️ El dispositivo está fuera de la geocerca');
  }
} catch (err) {
  if (err instanceof GeofenceNotFoundError) {
    console.warn('La geocerca solicitada no existe');
  } else {
    throw err;
  }
}
```

### Validación General y Constructor Fluido

```ts
const generalRes = await client.spatial.validateGeneral(19.4326, -99.1332);

const fluentRes = await client.spatial
  .check(19.4326, -99.1332)
  .inGeofence('geofence_123')
  .execute();
```

---

## 👥 Módulo Users

```ts
import GeoEngine, { Roles, InvitationPendingError, LastAdminError } from 'geo-engine-node';

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

const users = await client.users.list();
const roles = await client.users.listRoles();
const user = await client.users.get('user_123');

try {
  const inv = await client.users.invite({
    email: 'ana@acme.com',
    role: Roles.Viewer,
    lang: 'es', // 'es' (default) | 'en' | 'pt'
  });
  console.log('Enlace de invitación:', inv.inviteUrl);
} catch (err) {
  if (err instanceof InvitationPendingError) {
    console.warn('Ya existe una invitación pendiente para este email');
  } else {
    throw err;
  }
}
```

---

## 🛡️ Gestión de Reglas GeoIdentity (`client.geoIdentity`)

```ts
import { polygonFromLatLng, RuleActions, SubjectTypes } from 'geo-engine-node';

const area = polygonFromLatLng([
  [19.40, -99.20], [19.40, -99.10], [19.50, -99.10],
]);

const rule = await client.geoIdentity.createRule({
  name: 'Solo CDMX',
  action: RuleActions.Block,
  blackIpList: ['203.0.113.0/24'],
  blockTor: true,
  geoLimit: area,
  assignedSubjects: [{ subjectType: SubjectTypes.User, subjectId: 'user_123' }],
});

await client.geoIdentity.updateRule(rule.id, { isActive: false, geoLimit: null });
await client.geoIdentity.deleteRule(rule.id);
```

---

## 🚧 Creación de Geocercas (Polígonos PostGIS)

El SDK valida el formato `[latitud, longitud]`, convierte automáticamente a GeoJSON `[longitud, latitud]` y asegura el cierre del polígono:

```ts
const coordenadasZona: [number, number][] = [
  [19.4326, -99.1332],
  [19.4426, -99.1332],
  [19.4426, -99.1232],
];

await client.createGeofence(
  'Parque Logístico Norte',
  coordenadasZona,
  'https://mi-api.com/webhooks/geocercas'
);
```

---

## 🔄 Ingesta Asíncrona en Lotes (`AsyncIngester`)

Encola coordenadas en memoria y las despacha periódicamente (una petición `sendLocation` por coordenada):

```ts
import GeoEngine from 'geo-engine-node';

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);
const ingester = client.createAsyncIngester(5000, 100, 500);

const ok = ingester.enqueue({
  deviceId: 'camion-45',
  latitude: 19.4326,
  longitude: -99.1332,
  timestamp: Date.now(),
});

await ingester.stop();
client.close();
```

---

## 🔧 Configuración Avanzada

```ts
const client = new GeoEngine(process.env.GEOENGINE_API_KEY!, {
  environment: 'live', // 'live' | 'test' (cabecera X-Geo-Environment en rutas legadas)
  jwtToken: 'mi.jwt.token',
  timeout: 5000, // milisegundos para rutas legadas
  identityTimeoutMs: 500, // plazo total para client.identity.evaluate en ms
  maxRetries: 2, // reintentos en rutas legadas
  managementUrl: 'https://management.geoengine.dev',
  ingestUrl: 'https://ingest.geoengine.dev',
  apiServiceUrl: 'https://api.geoengine.dev',
});
```

### Opciones Disponibles

| Opción | Tipo | Descripción | Default |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | Clave secreta de autenticación (almacenada en privado; no expuesta en `client.options`) | (requerido) |
| `environment` | `string` | Target (`'live'` o `'test'`) en cabecera `X-Geo-Environment` de rutas legadas | `'live'` |
| `jwtToken` | `string` | Token Bearer opcional en rutas legadas | `undefined` |
| `apiServiceUrl` | `string` | URL del api-service (Spatial, Users, GeoIdentity y `/v1/evaluate`) | `'https://api.geoengine.dev'` |
| `ingestUrl` | `string` | URL del servicio de ingestión de telemetría | `'https://ingest.geoengine.dev'` |
| `managementUrl` | `string` | URL del servicio de control y geocercas | `'https://management.geoengine.dev'` |
| `baseUrl` | `string` | Sobrescribe ingest, management y apiService juntas. Debe ser `https` (`http` solo para `localhost`, `127.0.0.1` o `::1`); si no, el constructor lanza `ValidationError`. Nunca se siguen redirecciones. | `undefined` |
| `timeout` | `number` | Tiempo límite en ms para rutas legadas (`AbortController`) | `10000` |
| `identityTimeoutMs` | `number` | Plazo total en ms para `client.identity.evaluate` (incluye reintento) | `500` |
| `maxRetries` | `number` | Reintentos exponenciales (`429`, `5xx`, red) en rutas legadas (solo `GET` en `users`/`geoIdentity`) | `2` |
| `batchSize` | `number` | Tamaño de lote para `AsyncIngester` | `100` |
| `flushInterval` | `number` | Intervalo de vaciado de `AsyncIngester` en ms | `500` |
| `bufferSize` | `number` | Capacidad máxima de la cola de `AsyncIngester` | `5000` |

> **Autenticación legada vs `/v1/evaluate`:** Las rutas legadas envían `X-API-Key`, `X-Geo-Environment`, `X-Request-Time` y `X-Signature` (HMAC-SHA256 del timestamp usando `apiKey`, más `Authorization: Bearer` si se configura `jwtToken`). `/v1/evaluate` envía **únicamente** `Authorization: Bearer <apiKey>` y `X-Request-Id`.

---

## 🛡️ Jerarquía de Errores Tipados

> `err.code` es el contrato estable entre formatos: los builds ESM y CJS incluyen cada uno sus propias clases de error (por eso `instanceof` no funciona entre formatos), pero los valores de `code` son idénticos.

```ts
import {
  GeoEngineError,
  ValidationError,
  GeofenceNotFoundError,
  QuotaExceededError,
  AuthenticationError,
  ForbiddenError,
  TimeoutError,
  SpatialAPIError,
} from 'geo-engine-node';

try {
  await client.spatial.validatePoint('geo-x', lat, lng);
} catch (error) {
  if (error instanceof GeofenceNotFoundError) {
    // 204 No Content o 404 Not Found
  } else if (error instanceof QuotaExceededError) {
    // 402 Payment Required o código QUOTA_EXCEEDED
  } else if (error instanceof AuthenticationError) {
    // 401 Unauthorized, MISSING_API_KEY o MISSING_ORGANIZATION
  } else if (error instanceof ForbiddenError) {
    // 403 Forbidden
  } else if (error instanceof TimeoutError) {
    // Tiempo de espera agotado
  } else if (error instanceof ValidationError) {
    // Validación local fallida (coordenadas fuera de rango o ID faltante)
  }
}
```

Los módulos Users y CRUD de GeoIdentity lanzan subclases de `APIServiceError` (`UserNotFoundError`, `RuleNotFoundError`, `UserAlreadyExistsError`, `InvitationPendingError`, `LastAdminError`, `LastSubjectError`) y solo reintentan peticiones `GET`.

GeoIdentity `/v1/evaluate` lanza `IdentityTransientError` (red, timeout, `5xx`, `429`) o `IdentityIntegrationError` (`400`, `401`, `403` incluido el `403` de borde, `404`, `422`, payload o configuración inválida) y exporta `isTransient(err)`.

---

## 🧪 Pruebas y Compilación

Todas las pruebas se ejecutan localmente contra servidores `node:http` simulados (sin red real):

```bash
npm run typecheck
npm run build
npm test
```

---

## 📄 Licencia

MIT © Geo-Engine Team
