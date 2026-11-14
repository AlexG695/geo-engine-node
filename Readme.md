# 📦 Geo-Engine Node.js & TypeScript SDK

[![NPM Version](https://img.shields.io/npm/v/geo-engine-node?style=flat-square&color=blue)](https://www.npmjs.com/package/geo-engine-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Vitest-green.svg)](https://vitest.dev/)

> *Read this in Spanish: [README.es.md](./README.es.md)*

Official idiomatic **Node.js & TypeScript** client for the **Geo-Engine** platform.  
Designed for **high performance**, strict type-safety, and 1:1 parity with the official Go SDK (`v2.1.0`). Seamlessly integrates into backend microservices, Serverless functions, and modern edge environments.

---

## ✨ Features

- 📍 **Real-time Ingestion:** Sub-10ms telemetry coordinate dispatch via HTTP REST.
- 🗺️ **Advanced Spatial Module:** High-performance Point-in-Polygon spatial evaluation (single and general validation against all geofences).
- 👥 **Users Module:** Management of organization members, roles, and email invitations.
- 🛡️ **GeoIdentity Module:** Access rules (IP blacklists, geographic boundaries, Tor/datacenter blocking) assignable to users or to the entire organization.
- 🏗️ **Fluent Query Builder:** Fluent syntax `client.spatial.check(lat, lng).inGeofence(...)` for maximum readability.
- 🚧 **Geofence Management:** Dynamic creation and automatic normalization of PostGIS-backed GeoJSON polygons.
- 🔄 **Background AsyncIngester:** In-memory queue with auto-flush by batch size and time interval for high-throughput fleet and IoT ingestion.
- 🛡️ **Native Security:** Automatic HMAC-SHA256 signature generation (`X-Signature`), anti-replay timestamps, and JWT Bearer token support.
- 📦 **Dual Package (ESM & CommonJS):** Compatible with native `import` and `require()`, bundled with `tsup` and full `.d.ts` type definitions.
- ⚡ **Zero Runtime Dependencies:** Built on standard Node.js APIs (native `fetch`, `node:crypto`, `AbortController`). Compatible with Serverless and Edge runtimes (Cloudflare Workers, Next.js, Bun).

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

### CommonJS (Legacy)

```js
const GeoEngine = require('geo-engine-node');

const client = new GeoEngine('geo_live_123456');

client.sendLocation('scooter-09', 19.4326, -99.1332)
  .then(() => console.log('Location registered'))
  .catch((err) => console.error(err));
```

---

## 🗺️ Spatial Module & Point Validation

The `client.spatial` module connects directly to the GeoEngine API service to evaluate spatial containment:

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

For maximum readability, you can construct fluent queries:

```ts
// Validation in a specific geofence
const singleRes = await client.spatial
  .check(19.4326, -99.1332)
  .inGeofence('geofence_123')
  .execute();

// Validation against all geofences
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

// List members and available roles
const users = await client.users.list();
const roles = await client.users.listRoles();
const user = await client.users.get('user_123');

// Invite a new member (GeoEngine sends the invitation email)
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

// Update a member's role or revoke their access
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

## 🛡️ GeoIdentity Module

The `client.geoIdentity` module creates access rules and assigns them to a user or to the entire organization:

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

// Query, update, and delete
const rules = await client.geoIdentity.listRules({ isActive: true });
const detail = await client.geoIdentity.getRule(rule.id); // includes assignedSubjects
await client.geoIdentity.updateRule(rule.id, { isActive: false, geoLimit: null }); // null removes the geographic boundary
await client.geoIdentity.deleteRule(rule.id);

// Assign or unassign the rule
await client.geoIdentity.assignToUser(rule.id, 'user_456');
await client.geoIdentity.assignToOrganization(rule.id);
await client.geoIdentity.unassignFromUser(rule.id, 'user_456');

// Rules that apply to a user (direct, by role, or organization-wide)
const userRules = await client.geoIdentity.listUserRules('user_123');
```

> A rule created without `assignedSubjects` applies to the entire organization. A rule must always retain at least one subject: removing the last subject throws `LastSubjectError` (deactivate or delete the rule instead).

---

## 🚧 Geofence Creation (PostGIS Polygons)

Create spatial zones dynamically. The SDK validates the `[latitude, longitude]` format, automatically converts it to GeoJSON `[longitude, latitude]`, and ensures the polygon is closed:

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

## 🔄 High-Throughput Async Batch Ingestion (`AsyncIngester`)

For high-volume fleet tracking or IoT telemetry, use the in-memory queue with auto-flush:

```ts
import GeoEngine, { AsyncIngester } from 'geo-engine-node';

const client = new GeoEngine('geo_live_123456');

// Queue: 5000 pings buffer, flush every 100 items or every 500ms
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

// On service shutdown, drain all pending items:
await ingester.stop();
client.close();
```

---

## 🔧 Advanced Configuration

You can configure the client using the options object:

```ts
const client = new GeoEngine('geo_live_123456', {
  environment: 'live', // 'live' | 'test'
  jwtToken: 'my.jwt.token',
  timeout: 5000, // milliseconds
  maxRetries: 3, // retries with exponential backoff on 429/5xx
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
| `apiKey` | `string` | Secret authentication key | (required) |
| `environment` | `string` | Target (`'live'` or `'test'`) for the `X-Geo-Environment` header | `'live'` |
| `jwtToken` | `string` | Bearer token for authorized operations | `undefined` |
| `apiServiceUrl` | `string` | URL of the API service (Spatial, Users, and GeoIdentity) | `'https://api.geoengine.dev'` |
| `ingestUrl` | `string` | URL of the telemetry ingestion service | `'https://ingest.geoengine.dev'` |
| `managementUrl` | `string` | URL of the control plane and geofence service | `'https://management.geoengine.dev'` |
| `baseUrl` | `string` | Overrides ingest, management, and apiService endpoints together | `undefined` |
| `timeout` | `number` | Request timeout in ms (via `AbortController`) | `10000` |
| `maxRetries` | `number` | Retries with exponential backoff on transient errors | `2` |
| `batchSize` | `number` | Batch size for `AsyncIngester` | `100` |
| `flushInterval` | `number` | Flush interval for `AsyncIngester` in ms | `500` |
| `bufferSize` | `number` | Maximum queue capacity for `AsyncIngester` | `5000` |

---

## 🛡️ Typed Error Hierarchy

The SDK maps all HTTP status codes and responses into a clean error class hierarchy:

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
    // 204 No Content or 404 Not Found
  } else if (error instanceof QuotaExceededError) {
    // 402 Payment Required or 429
  } else if (error instanceof AuthenticationError) {
    // 401 Unauthorized or MISSING_API_KEY
  } else if (error instanceof TimeoutError) {
    // Request timed out
  } else if (error instanceof ValidationError) {
    // Coordinate out of range [-90,90] or invalid parameter
  }
}
```

The Users and GeoIdentity modules throw `APIServiceError` (with `statusCode`, `code`, and `apiMessage`) or one of its subclasses:

| Error | API Code | When it occurs |
| :--- | :--- | :--- |
| `UserNotFoundError` | `USER_NOT_FOUND`, `USER_REVOKED` | User does not exist in the organization |
| `RuleNotFoundError` | `RULE_NOT_FOUND` | GeoIdentity rule does not exist |
| `UserAlreadyExistsError` | `USER_ALREADY_EXISTS` | Invited email already belongs to the organization |
| `InvitationPendingError` | `INVITATION_PENDING` | There is already a pending invitation for this email |
| `LastAdminError` | `LAST_ADMIN` | Operation would leave the organization without administrators |
| `LastSubjectError` | `LAST_SUBJECT` | Operation would leave the rule without assigned subjects |

Errors 401, 403, and 402 reuse `AuthenticationError`, `ForbiddenError`, and `QuotaExceededError`. Local validations throw `UserIDRequiredError`, `RuleIDRequiredError`, `RuleNameRequiredError`, `EmailRequiredError`, or `RoleRequiredError` without calling the API.

> In Users and GeoIdentity, only read requests (`GET`) are automatically retried on 429/5xx; write operations are never retried to prevent duplicate invitations or assignments.

---

## 🧪 Testing and Building

Run the unit and integration test suite with Vitest:

```bash
npm run test
```

To compile CJS and ESM outputs with TypeScript type definitions:

```bash
npm run build
npm run typecheck
```

---

## 📄 License

MIT © Geo-Engine Team
