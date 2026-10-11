# 📦 Geo-Engine Node.js & TypeScript SDK

[![NPM Version](https://img.shields.io/npm/v/geo-engine-node?style=flat-square&color=blue)](https://www.npmjs.com/package/geo-engine-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Vitest-green.svg)](https://vitest.dev/)

Official idiomatic **Node.js & TypeScript** client for the **Geo-Engine** platform.  
Designed for **high performance**, strict type-safety, and parity 1:1 with the official Go SDK (`v2.0.3`). Seamlessly integrates into backend microservices, Serverless functions, and modern edge environments.

---

## ✨ Features

- 📍 **Ingesta en tiempo real:** Envío sub-10ms de coordenadas de telemetría por HTTP REST.
- 🗺️ **Módulo Spatial avanzado:** Evaluación espacial punto-en-polígono (Point-in-Polygon) de alto rendimiento (validación individual y general contra todas las geocercas).
- 🏗️ **Fluent Query Builder:** Sintaxis fluida `client.spatial.check(lat, lng).inGeofence(...)` para máxima legibilidad.
- 🚧 **Gestión de geocercas:** Creación dinámica y normalización automática de polígonos GeoJSON respaldados por PostGIS.
- 🔄 **AsyncIngester en segundo plano:** Cola con auto-flush por tamaño de lote e intervalo de tiempo para alta ingesta en flotas e IoT.
- 🛡️ **Seguridad nativa:** Generación automática de firmas HMAC-SHA256 (`X-Signature`), timestamp anti-replay y soporte para tokens JWT Bearer.
- 📦 **Dual Package (ESM & CommonJS):** Compatible con `import` nativo y `require()`, empaquetado con `tsup` y definiciones de tipos `.d.ts`.
- ⚡ **Zero dependencias en runtime:** Desarrollado sobre APIs estándar de Node.js (`fetch` nativo, `node:crypto`, `AbortController`). Compatible con Serverless y Edge (Cloudflare Workers, Next.js, Bun).

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
const client = new GeoEngine('sk_live_123456');

try {
  await client.sendLocation('truck-01', 19.4326, -99.1332);
  console.log('✅ Coordenada enviada con éxito');
} catch (error) {
  console.error('❌ Error al enviar ubicación:', error);
} finally {
  client.close();
}
```

### CommonJS (Legacy)

```js
const GeoEngine = require('geo-engine-node');

const client = new GeoEngine('sk_live_123456');

client.sendLocation('scooter-09', 19.4326, -99.1332)
  .then(() => console.log('Ubicación registrada'))
  .catch((err) => console.error(err));
```

---

## 🗺️ Módulo Spatial & Validación de Puntos

El módulo `client.spatial` conecta directamente con el servicio de API de GeoEngine para evaluar contención espacial:

### Validación contra una Geocerca Individual

```ts
import GeoEngine, { GeofenceNotFoundError } from 'geo-engine-node';

const client = new GeoEngine('sk_live_123456');

try {
  const res = await client.spatial.validatePoint('geofence_123', 19.4326, -99.1332);

  if (res.isInside()) {
    console.log(`✅ El dispositivo está dentro de ${res.geofenceName} (${res.geofenceId})`);
  } else {
    console.log('⚠️ El dispositivo está fuera de la geocerca');
  }

  console.log('Coordenadas:', res.coordinates()); // [19.4326, -99.1332]
  console.log('Log formateado:', res.toString()); // [INSIDE] geofence=geofence_123 (Centro) at (19.432600, -99.133200)
} catch (err) {
  if (err instanceof GeofenceNotFoundError) {
    console.warn('La geocerca solicitada no existe');
  } else {
    throw err;
  }
}
```

### Validación General (Contra Todas las Geocercas Activas)

```ts
const res = await client.spatial.validateGeneral(19.4326, -99.1332);

if (res.hasMatches()) {
  console.log(`Coincide con ${res.totalMatches} geocercas:`, res.geofenceNames());
  
  if (res.containsGeofence('CDMX Centro')) {
    console.log('El vehículo está en CDMX Centro');
  }

  const match = res.findMatch('CDMX Centro');
  console.log('ID encontrado:', match?.id);
}
```

### Fluent Query Builder

Para mayor legibilidad, puedes construir consultas fluidas:

```ts
// Validación en geocerca específica
const singleRes = await client.spatial
  .check(19.4326, -99.1332)
  .inGeofence('geofence_123')
  .execute();

// Validación contra todas las geocercas
const generalRes = await client.spatial
  .check(19.4326, -99.1332)
  .inAllGeofences()
  .execute();
```

---

## 🚧 Creación de Geocercas (Polígonos PostGIS)

Crea zonas espaciales dinámicamente. El SDK valida el formato `[latitud, longitud]`, convierte automáticamente a GeoJSON `[longitud, latitud]` y asegura el cierre del polígono:

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

Para telemetría masiva de flotas de vehículos o dispositivos IoT, utiliza la cola en memoria con auto-flush:

```ts
import GeoEngine, { AsyncIngester } from 'geo-engine-node';

const client = new GeoEngine('sk_live_123456');

// Cola: buffer 5000 pings, flush cada 100 items o cada 500ms
const ingester = client.createAsyncIngester(5000, 100, 500);

const ok = ingester.enqueue({
  deviceId: 'camion-45',
  latitude: 19.4326,
  longitude: -99.1332,
  timestamp: Date.now(),
});

if (!ok) {
  console.warn('Buffer lleno o ingester detenido');
}

// Al apagar el servicio, drena todos los elementos pendientes:
await ingester.stop();
client.close();
```

---

## 🔧 Configuración Avanzada

Puedes configurar el cliente mediante el objeto de opciones:

```ts
const client = new GeoEngine('sk_live_123456', {
  environment: 'live', // 'live' | 'test'
  jwtToken: 'mi.jwt.token',
  timeout: 5000, // milisegundos
  maxRetries: 3, // reintentos con backoff exponencial ante 429/5xx
  managementUrl: 'https://management.geoengine.dev',
  ingestUrl: 'https://ingest.geoengine.dev',
  apiServiceUrl: 'https://api.geoengine.dev',
  // O para pruebas locales/mock:
  // baseUrl: 'http://localhost:8080',
});
```

### Opciones Disponibles

| Opción | Tipo | Descripción | Default |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | Clave secreta de autenticación | (requerido) |
| `environment` | `string` | Target (`'live'` o `'test'`) para header `X-Geo-Environment` | `'live'` |
| `jwtToken` | `string` | Token Bearer para operaciones autorizadas | `undefined` |
| `apiServiceUrl` | `string` | URL del servicio para consultas espaciales | `'https://api.geoengine.dev'` |
| `ingestUrl` | `string` | URL del servicio de ingestión de telemetría | `'https://ingest.geoengine.dev'` |
| `managementUrl` | `string` | URL del servicio de control y geocercas | `'https://management.geoengine.dev'` |
| `baseUrl` | `string` | Sobrescribe ingest, management y apiService juntas | `undefined` |
| `timeout` | `number` | Tiempo límite de espera en ms (vía `AbortController`) | `10000` |
| `maxRetries` | `number` | Reintentos con backoff exponencial ante fallos transitorios | `2` |
| `batchSize` | `number` | Tamaño de lote para `AsyncIngester` | `100` |
| `flushInterval` | `number` | Intervalo de vaciado de `AsyncIngester` en ms | `500` |
| `bufferSize` | `number` | Capacidad máxima de la cola de `AsyncIngester` | `5000` |

---

## 🛡️ Jerarquía de Errores Tipados

El SDK mapea todos los códigos de estado y respuestas en una jerarquía clara de clases de error:

```ts
import {
  GeoEngineError,
  ValidationError,
  InvalidLatitudeError,
  InvalidLongitudeError,
  DeviceIDRequiredError,
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
    // 402 Payment Required o 429
  } else if (error instanceof AuthenticationError) {
    // 401 Unauthorized o MISSING_API_KEY
  } else if (error instanceof TimeoutError) {
    // Tiempo de espera agotado
  } else if (error instanceof ValidationError) {
    // Coordenada fuera de rango [-90,90] o parámetro inválido
  }
}
```

---

## 🧪 Pruebas y Compilación

Ejecuta la suite de pruebas unitarias e integración con Vitest:

```bash
npm run test
```

Para compilar las salidas CJS y ESM con tipos TypeScript:

```bash
npm run build
npm run typecheck
```

---

## 📄 Licencia

MIT © Geo-Engine Team
