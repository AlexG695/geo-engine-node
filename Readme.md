# 📦 Geo-Engine Node.js & TypeScript SDK

[![NPM Version](https://img.shields.io/npm/v/geo-engine-node?style=flat-square&color=blue)](https://www.npmjs.com/package/geo-engine-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Vitest%20%2B%20node%3Atest-green.svg)](https://vitest.dev/)

> *Read this in Spanish: [README.es.md](./README.es.md)*

Official **Node.js & TypeScript** client for the **Geo-Engine** platform (`v2.1.0`).  
Designed for strict TypeScript safety, zero runtime dependencies, and server-side integration in Node.js `>=18`.

---

## ✨ Features

- 📍 **Telemetry Ingestion:** HTTP REST location dispatch (`sendLocation`) and background `AsyncIngester`.
- 🗺️ **Spatial Module:** Point-in-polygon evaluation (single geofence and general validation against all active geofences) plus fluent query builder `client.spatial.check(lat, lng)`.
- 👥 **Users Module:** Management of organization members, roles, and email invitations (`client.users`).
- 🛡️ **GeoIdentity Rules & Runtime Evaluation:** Rule CRUD (`client.geoIdentity`) and server-only access decision evaluation via `client.identity.evaluate(...)` and `geo-engine-node/identity` (`identityGuard`).
- 🚧 **Geofence Management:** Creation and automatic normalization of PostGIS-backed GeoJSON polygons (`createGeofence`).
- 📦 **Dual Package (ESM & CommonJS):** Compatible with native `import` and `require()`, bundled with `tsup` and `.d.ts` / `.d.cts` type definitions.
- ⚡ **Zero Runtime Dependencies:** Built on standard Node.js APIs (`fetch`, `node:crypto`, `node:timers`, `AbortController`) for Node.js `>=18` server runtimes.

> **Runtime Note:** The SDK imports `node:crypto` and `node:timers` and is intended for **Node.js server runtimes** (edge runtimes without Node compatibility are not supported). The secret `apiKey` is stored in a private `#` field and is omitted from `client.options`, `JSON.stringify`, and `util.inspect`.

---

## 🚀 Installation

```bash
npm install geo-engine-node
```

Or using Yarn / PNPM / Bun:

```bash
pnpm add geo-engine-node
# or
bun add geo-engine-node
```

---

## ⚡ Quick Start

### TypeScript / ES Modules (Recommended)

```ts
import GeoEngine from 'geo-engine-node';

// Initialize with your secret API key
const client = new GeoEngine('geo_live_123456');

try {
  await client.sendLocation('truck-01', 19.4326, -99.1332);
  console.log('✅ Coordinate sent successfully');
} catch (error) {
  console.error('❌ Error sending location:', error);
} finally {
  client.close();
}
```

### CommonJS

```js
const GeoEngine = require('geo-engine-node');

const client = new GeoEngine('geo_live_123456');

client.sendLocation('scooter-09', 19.4326, -99.1332)
  .then(() => console.log('Location registered'))
  .catch((err) => console.error(err));
```

---

## 🛡️ GeoIdentity Runtime Evaluation (`/v1/evaluate` & `identityGuard`)

> [!IMPORTANT]
> **Server-only & Secret API Key:** `POST /v1/evaluate` authenticates strictly with `Authorization: Bearer <secret_api_key>` and does **not** allow browser CORS requests. Never expose your API key or import `geo-engine-node/identity` in browser code (loading it when `window` is defined throws immediately).

### Direct Evaluation (`client.identity.evaluate`)

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
    // Handle block
  } else if (decision.decision === 'CHALLENGE') {
    // Prompt step-up verification (e.g. decision.challenge?.hint)
  }
} catch (err) {
  if (isTransient(err)) {
    // Network, timeout, 5xx, or 429 after 500ms deadline / single retry
  } else if (err instanceof IdentityIntegrationError) {
    // 400, 401, edge 403, 404, 422, or malformed response (do NOT fail open)
  }
}
```

### Express / Connect Middleware (`identityGuard`)

```ts
import GeoEngine from 'geo-engine-node';
import { identityGuard } from 'geo-engine-node/identity';

const client = new GeoEngine(process.env.GEOENGINE_API_KEY!);

app.post(
  '/login',
  identityGuard({
    client,
    scope: 'login',
    failOpen: false, // REQUIRED: true allows on transient error, false blocks (403)
    getSubject: (req) => ({ user_id: req.body.userId, device_id: req.headers['x-device-id'] as string }),
    getContext: (req) => ({
      ip: req.ip,
      location: req.body.location, // If omitted and scope has geo rules, engine may block with `location_missing`
    }),
    onChallenge: async (decision, _req, res) => {
      res.status(403).json({ error: 'challenge_required', hint: decision.challenge?.hint ?? 'step_up' });
    },
    onIntegrationError: (err) => {
      console.error('GeoIdentity integration error:', err);
    },
  }),
  loginHandler
);
```

- **`failOpen` (mandatory, no default):** applies **only** to transient errors (`timeout`, `network`, `server_error`, `rate_limited`) and unknown `decision` values (`unknown_decision`). When triggered, `onDecision` receives a synthetic `FallbackDecision` with `fallback: true`, `fallback_reason`, and `meta.source = 'sdk_fallback'`.
- **Integration errors never fail open:** `400`, `401`, `403` (including non-JSON edge `403`), `404`, `422`, local invalid inputs, or unexpected payloads throw `IdentityIntegrationError`, invoke `onIntegrationError`, and return HTTP `500` (`{ error: 'internal_error' }`).
- **`CHALLENGE`:** invokes `onChallenge` if provided; if omitted, responds `403` with `{ error: 'challenge_required', hint: 'step_up' }` and never falls through to `next()`.
- **`context.location`:** when the scope evaluates geographic conditions and `location` is absent, `/v1/evaluate` returns HTTP `200` with the `location_missing` signal (which may result in `BLOCK` as a normal policy decision, not an error).
- **Deadline & retries:** `evaluate` enforces a `500 ms` total deadline by default (`identityTimeoutMs` or per-call `timeoutMs`) with at most 1 jittered retry on transient failures (honoring `Retry-After` if it fits in the remaining budget), reusing the same `X-Request-Id`.

---

## 🗺️ Spatial Module & Point Validation

The `client.spatial` module connects to the GeoEngine API service to evaluate spatial containment:

### Single Geofence Validation

```ts
import GeoEngine, { GeofenceNotFoundError } from 'geo-engine-node';

const client = new GeoEngine('geo_live_123456');

try {
  const res = await client.spatial.validatePoint('geofence_123', 19.4326, -99.1332);

  if (res.isInside()) {
    console.log(`✅ The device is inside ${res.geofenceName} (${res.geofenceId})`);
  } else {
    console.log('⚠️ The device is outside the geofence');
  }

  console.log('Coordinates:', res.coordinates()); // [19.4326, -99.1332]
  console.log('Formatted log:', res.toString()); // [INSIDE] geofence=geofence_123 (Downtown) at (19.432600, -99.133200)
} catch (err) {
  if (err instanceof GeofenceNotFoundError) {
    console.warn('The requested geofence does not exist');
  } else {
    throw err;
  }
}
```

### General Validation (Against All Active Geofences)

```ts
const res = await client.spatial.validateGeneral(19.4326, -99.1332);

if (res.hasMatches()) {
  console.log(`Matched ${res.totalMatches} geofences:`, res.geofenceNames());

  if (res.containsGeofence('CDMX Downtown')) {
    console.log('The vehicle is in CDMX Downtown');
  }

  const match = res.findMatch('CDMX Downtown');
  console.log('Found ID:', match?.id);
}
```

### Fluent Query Builder

```ts
const singleRes = await client.spatial
  .check(19.4326, -99.1332)
  .inGeofence('geofence_123')
  .execute();

const generalRes = await client.spatial
  .check(19.4326, -99.1332)
  .inAllGeofences()
  .execute();
```

---

## 👥 Users Module

The `client.users` module manages the members of the organization that owns the API key:

```ts
import GeoEngine, { Roles, InvitationPendingError, LastAdminError } from 'geo-engine-node';

const client = new GeoEngine('geo_live_123456');

const users = await client.users.list();
const roles = await client.users.listRoles();
const user = await client.users.get('user_123');

try {
  const inv = await client.users.invite({
    email: 'ana@acme.com',
    role: Roles.Viewer,
    lang: 'es', // 'es' (default) | 'en' | 'pt'
  });
  console.log('Invitation link:', inv.inviteUrl);
} catch (err) {
  if (err instanceof InvitationPendingError) {
    console.warn('There is already a pending invitation for this email');
  } else {
    throw err;
  }
}

try {
  await client.users.updateRole('user_123', Roles.Dispatcher);
  await client.users.remove('user_123');
} catch (err) {
  if (err instanceof LastAdminError) {
    console.warn('The organization must retain at least one administrator');
  } else {
    throw err;
  }
}
```

---

## 🛡️ GeoIdentity Rules Management (`client.geoIdentity`)

The `client.geoIdentity` module manages access rules and subject assignments:

```ts
import { polygonFromLatLng, RuleActions, SubjectTypes } from 'geo-engine-node';

const area = polygonFromLatLng([
  [19.40, -99.20], [19.40, -99.10], [19.50, -99.10], // [lat, lng]
]);

const rule = await client.geoIdentity.createRule({
  name: 'CDMX Only',
  action: RuleActions.Block,
  blackIpList: ['203.0.113.0/24'],
  blockTor: true,
  geoLimit: area,
  assignedSubjects: [{ subjectType: SubjectTypes.User, subjectId: 'user_123' }],
});

const rules = await client.geoIdentity.listRules({ isActive: true });
const detail = await client.geoIdentity.getRule(rule.id);
await client.geoIdentity.updateRule(rule.id, { isActive: false, geoLimit: null });
await client.geoIdentity.deleteRule(rule.id);
```

---

## 🚧 Geofence Creation (PostGIS Polygons)

Create spatial zones dynamically. The SDK validates `[latitude, longitude]`, converts to GeoJSON `[longitude, latitude]`, and ensures the polygon ring is closed:

```ts
const zoneCoordinates: [number, number][] = [
  [19.4326, -99.1332],
  [19.4426, -99.1332],
  [19.4426, -99.1232],
];

await client.createGeofence(
  'North Logistics Park',
  zoneCoordinates,
  'https://my-api.com/webhooks/geofences'
);
```

---

## 🔄 Async Batch Ingestion (`AsyncIngester`)

Queue telemetry pings in memory and dispatch them periodically (`sendLocation` per ping):

```ts
import GeoEngine from 'geo-engine-node';

const client = new GeoEngine('geo_live_123456');
const ingester = client.createAsyncIngester(5000, 100, 500);

const ok = ingester.enqueue({
  deviceId: 'truck-45',
  latitude: 19.4326,
  longitude: -99.1332,
  timestamp: Date.now(),
});

if (!ok) {
  console.warn('Buffer queue full or ingester stopped');
}

await ingester.stop();
client.close();
```

---

## 🔧 Advanced Configuration

```ts
const client = new GeoEngine('geo_live_123456', {
  environment: 'live', // 'live' | 'test' (sent as X-Geo-Environment on legacy routes)
  jwtToken: 'my.jwt.token',
  timeout: 5000, // legacy routes timeout in ms
  identityTimeoutMs: 500, // total deadline for client.identity.evaluate in ms
  maxRetries: 2, // legacy routes retry count
  managementUrl: 'https://management.geoengine.dev',
  ingestUrl: 'https://ingest.geoengine.dev',
  apiServiceUrl: 'https://api.geoengine.dev',
  // Or for local/mock testing:
  // baseUrl: 'http://localhost:8080',
});
```

### Available Options

| Option | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | Secret authentication key (stored privately; not exposed on `client.options`) | (required) |
| `environment` | `string` | Target (`'live'` or `'test'`) sent in `X-Geo-Environment` on legacy routes | `'live'` |
| `jwtToken` | `string` | Optional Bearer token sent on legacy routes | `undefined` |
| `apiServiceUrl` | `string` | URL of the API service (Spatial, Users, GeoIdentity, `/v1/evaluate`) | `'https://api.geoengine.dev'` |
| `ingestUrl` | `string` | URL of the telemetry ingestion service | `'https://ingest.geoengine.dev'` |
| `managementUrl` | `string` | URL of the control plane and geofence service | `'https://management.geoengine.dev'` |
| `baseUrl` | `string` | Overrides ingest, management, and apiService endpoints together | `undefined` |
| `timeout` | `number` | Legacy request timeout in ms (via `AbortController`) | `10000` |
| `identityTimeoutMs` | `number` | Total deadline in ms for `client.identity.evaluate` (including retry) | `500` |
| `maxRetries` | `number` | Exponential backoff retries (`429`, `5xx`, network) on legacy routes (`GET`-only for `users`/`geoIdentity`) | `2` |
| `batchSize` | `number` | Batch size for `AsyncIngester` | `100` |
| `flushInterval` | `number` | Flush interval for `AsyncIngester` in ms | `500` |
| `bufferSize` | `number` | Maximum queue capacity for `AsyncIngester` | `5000` |

> **Legacy vs `/v1/evaluate` Authentication:** Legacy routes send `X-API-Key`, `X-Geo-Environment`, `X-Request-Time`, and `X-Signature` (HMAC-SHA256 of the timestamp using `apiKey`, plus `Authorization: Bearer` if `jwtToken` is set). `/v1/evaluate` sends **only** `Authorization: Bearer <apiKey>` and `X-Request-Id`.

---

## 🛡️ Typed Error Hierarchy

Legacy and Spatial routes map HTTP status codes as follows:

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
    // 204 No Content or 404 Not Found
  } else if (error instanceof QuotaExceededError) {
    // 402 Payment Required or reason QUOTA_EXCEEDED
  } else if (error instanceof AuthenticationError) {
    // 401 Unauthorized, MISSING_API_KEY, or MISSING_ORGANIZATION
  } else if (error instanceof ForbiddenError) {
    // 403 Forbidden
  } else if (error instanceof TimeoutError) {
    // Request timed out
  } else if (error instanceof ValidationError) {
    // Local validation failure (e.g. out-of-range coordinates or missing ID)
  }
}
```

Users and GeoIdentity rule CRUD endpoints throw `APIServiceError` subclasses (`UserNotFoundError`, `RuleNotFoundError`, `UserAlreadyExistsError`, `InvitationPendingError`, `LastAdminError`, `LastSubjectError`) and only retry `GET` requests.

GeoIdentity `/v1/evaluate` throws `IdentityTransientError` (network, timeout, `5xx`, `429`) or `IdentityIntegrationError` (`400`, `401`, `403` including edge `403`, `404`, `422`, invalid payload/config), exporting `isTransient(err)`.

---

## 🧪 Testing and Building

All tests run locally against simulated `node:http` servers (no live network required):

```bash
npm run typecheck
npm run build
npm test
```

---

## 📄 License

MIT © Geo-Engine Team
