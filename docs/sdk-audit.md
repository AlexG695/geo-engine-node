# Auditoría del SDK público de GeoEngine (Node.js)

Modo solo lectura. Fecha: 2026-11-18. Rama `main`, commit `a7d06c3`.
Método: exploración con tres agentes de lectura (Haiku) más comprobaciones puntuales de existencia de archivos. No se ejecutaron tests, build, `npm pack` ni publicaciones. Lo que no se pudo verificar figura como "no determinado". No se incluyen valores de secretos ni URLs privadas.

---

## 1. Estructura

- **Paquete único**, no monorepo. Sin workspaces, turbo, nx ni lerna.
- Árbol (2 niveles, sin `node_modules` ni `.git`):
  - `src/`: `client`, `crypto`, `errors`, `geoidentity`, `http`, `index`, `ingester`, `models`, `spatial`, `users`, `validation` (`.ts`).
  - `tests/`: `apiservice`, `client`, `errors`, `ingester`, `spatial` (`.test.ts`).
  - `examples/simulation.js`.
  - Raíz: `package.json`, `package-lock.json`, `tsconfig.json`, `tsup.config.ts`, `Readme.md`, `README.es.md`, `.gitignore`.
  - `dist/` existe en local pero está en `.gitignore`. No determinado si coincide con `src/`.
  - No existen `.github/`, `docs/` (hasta este informe), `.npmrc`, `.nvmrc`, ESLint, Prettier ni config de vitest.
- Gestor: **npm** (`package-lock.json` v3; las 167 entradas resuelven a `registry.npmjs.org`).
- Build: **tsup 8.5.1**, entrada `src/index.ts`, formatos `esm` + `cjs`, `dts`, sourcemaps, sin minificar, sin splitting. Una sola entrada y sin `platform` definido (`tsup.config.ts`).
- Salida: `dist/index.js` (ESM), `dist/index.cjs`, `dist/index.d.ts`. `"type": "module"`.
- Node `>=18.0.0` (`engines`). TypeScript `^5.9.3`. `tsconfig.json`: target ES2022, `module`/`moduleResolution` NodeNext, `strict`, `noUnusedLocals/Parameters`, `noImplicitReturns`, `noUncheckedIndexedAccess`. Sin `lib` DOM. Excluye `tests/`.
- Git: 3 commits, 1 tag (`v1.1.3`), 24 archivos versionados.

## 2. Paquetes en npm

| Campo | Valor |
|---|---|
| Nombre | `geo-engine-node` (sin scope) |
| Versión en `package.json` | `2.1.0` |
| Licencia declarada | MIT (ver §8: falta el archivo) |
| `main` | `./dist/index.cjs` |
| `module` | `./dist/index.js` |
| `types` | `./dist/index.d.ts` |
| `exports` | solo `"."` → `types`, `import`, `require`. Sin subpaths |
| `files` | `["dist"]` |
| `dependencies` / `peerDependencies` | ninguna |
| `devDependencies` | `@types/node ^20`, `tsup ^8.5.1`, `typescript ^5.9.3`, `vitest ^2.1.8` |
| `publishConfig`, `repository`, `bugs`, `homepage` | ausentes |
| Scripts | `build`, `typecheck`, `test`, `test:watch`, `example`, `prepublishOnly` (= build) |

- Built-ins de Node usados: `node:crypto` (`src/crypto.ts:1`) y `node:timers` (`src/ingester.ts`). `fetch` global, inyectable.
- No determinado: si `geo-engine-node@2.1.0` está realmente publicado en npm (no se consultó el registro). Solo existe el tag `v1.1.3`.

## 3. Servicios cubiertos y superficie pública

No hay clases llamadas "Core" ni "GeoTarget". El cliente único `GeoEngine` agrupa tres APIs: gestión, ingesta y api-service. Cubre hoy: ingesta, geocercas, validación espacial, usuarios y GeoIdentity (reglas).

**`GeoEngine`** (`src/client.ts:23`; alias `Client` y export default)
- `constructor(apiKeyOrOptions: string | GeoEngineOptions, options?)`: crea el cliente.
- `sendLocation(deviceId, lat, lng)`: envía una posición (POST de ingesta).
- `createGeofence(name, coordinates, webhookUrl?)`: crea geocerca poligonal y cierra el anillo.
- `validateSpatialPoint/Location/General/GeneralLocation`: atajos a `SpatialService`.
- `createAsyncIngester(bufferSize?, batchSize?, flushIntervalMs?)`: crea el ingester.
- `close()`: bloquea llamadas nuevas (`ClientClosedError`).
- Propiedades `spatial`/`Spatial`, `users`/`Users`, `geoIdentity`/`GeoIdentity` (alias duplicados) y getter `options`.

**`SpatialService`** (`src/spatial.ts:16`)
- `validatePoint`, `validateLocation`, `validateGeneral`, `validateGeneralLocation`: ¿el punto está dentro de una geocerca o de alguna?
- `check(lat, lng)` devuelve un builder fluido: `.inGeofence(id)` → `SingleGeofenceCheck`; `.inAllGeofences()` → `GeneralGeofenceCheck`; ambos con `execute()` y `validate()`.

**`UsersService`** (`src/users.ts:136`)
- `list`, `get`, `listRoles`, `invite`, `updateRole`, `remove`.
- Constantes `Roles` (Admin, Dispatcher, Billing, Viewer, Device) y `UserStatus`. Tipos `User`, `Role`, `InviteUserRequest`, `Invitation`.

**`GeoIdentityService`** (`src/geoidentity.ts:194`): reglas de acceso geográfico, solo servidor a servidor.
- `createRule`, `listRules`, `getRule`, `updateRule` (`geoLimit: null` quita el límite), `deleteRule`.
- `assignToUser`, `unassignFromUser`, `assignToOrganization`, `unassignFromOrganization`, `listUserRules`.
- `polygonFromLatLng(coordinates)`: construye un Polygon GeoJSON.
- Constantes `RuleActions` (ALLOW, BLOCK, CHALLENGE) y `SubjectTypes`. Tipos `Rule`, `CreateRuleRequest`, `UpdateRuleRequest`, `ListRulesOptions`, `GeoLimit`, `SubjectAssignment`.

**`AsyncIngester`** (`src/ingester.ts:16`): cola en memoria.
- `enqueue(ping): boolean`, `flush()`, `stop()`. Interfaz `IngesterClient`.

**Modelos** (`src/models.ts`)
- `SpatialValidationResult` y `SpatialGeneralResult`, con helpers como `isInside()`, `firstMatch()` y `geofenceIds()`.
- `GeoEngineOptions`, `LocationPing`, `GeofenceRequest`, `GeofenceMatch` y otros tipos de petición y resultado.

**Utilidades:** `generateHMACSignature` (`crypto.ts:11`, exportada públicamente), `validateCoordinates`, `validateDeviceId`, `validateGeofenceId`, `validateAndNormalizePolygon` (`validation.ts`).

**Errores:** ver jerarquía en §6.

## 4. Transporte

- **Solo REST** sobre `fetch` global (`HttpClient.request`, `src/http.ts:238`). Sin gRPC, sin `grpc-js`, sin HTTP/2.
- **Archivos `.proto`:** ninguno. **Código generado:** ninguno. Todos los tipos están escritos a mano.
- `options.fetch` permite inyectar la implementación (`models.ts:73`). Si no hay `fetch` (Node < 18), las peticiones fallan con `TypeError`.
- **Navegador y edge: no compatible tal como se publica.**
  - `node:crypto` y `node:timers` son importaciones duras (también en `dist/index.js` y `dist/index.cjs`).
  - El README promete compatibilidad con "edge modernos", Workers, Bun y Next.js. Eso solo se cumple con compatibilidad Node (p. ej. `nodejs_compat` en Workers). No se verificó.
  - No hay `fs`, `http2`, `Buffer` ni `process.env` en `src/`.

## 5. Configuración y autenticación

- Inicialización: `new GeoEngine('<apiKey>')` o `new GeoEngine({ apiKey, ... })` (`client.ts:63`). Sin llave lanza `ValidationError`. El mensaje está en español (`client.ts:75`), el resto del SDK en inglés.
- Cabeceras en cada petición (`http.ts:259-272`):
  - `X-API-Key`: la llave en claro.
  - `X-Geo-Environment`.
  - `X-Request-Time`: milisegundos.
  - `X-Signature`: HMAC-SHA256 hex.
  - `User-Agent: GeoEngineNodeSDK/<versión>`, fijo en `http.ts:21`.
  - `Authorization: Bearer` si se pasa `jwtToken`.
- **Variables de entorno que lee: ninguna.** No hay `process.env` en `src/`.
- URL base: tres hosts por defecto (gestión, ingesta, api-service) codificados en `http.ts:211-213`, todos en el dominio público del proveedor. Configurables por servicio (`managementUrl`, `ingestUrl`, `apiServiceUrl`) o todos a la vez con `baseUrl`.
  - Si se pasan `baseUrl` y una URL específica, gana `baseUrl` y la otra se ignora en silencio (`??`).
  - No se valida el esquema: `http://` se acepta y enviaría llave y firma en claro. El README lo usa para mocks locales.
- Entornos: `environment` es un string libre (`'live'` por defecto, `'test'` documentado). Solo se envía como cabecera. **No existe un staging** y `test` usa los mismos hosts. Si el servidor enruta según esa cabecera: no determinado.
- Opciones de resiliencia: `timeout` (10000 ms), `maxRetries` (2), `batchSize` (100), `flushInterval` (500 ms), `bufferSize` (5000).

## 6. Fiabilidad

- **Timeout:** 10 s por intento, con `AbortController` interno (`http.ts:247-252`).
  - Hueco: el temporizador se limpia al recibir cabeceras (`:282-284`). Leer el cuerpo (`response.text()`, `:305`) no tiene límite de tiempo.
  - Un timeout produce `TimeoutError` y nunca se reintenta.
- **Reintentos:** 429, 5xx y errores de red. Backoff exponencial `min(100·2^n + jitter, 2000)` ms. No lee `Retry-After`.
  - Users y GeoIdentity: solo se reintenta GET.
  - **Los POST no idempotentes sí se reintentan:** `sendLocation`, `createGeofence` y los POST espaciales. Sin llave de idempotencia, un 5xx tras procesar la petición puede duplicar telemetría o geocercas.
  - El README solo menciona 429/5xx, no los errores de red.
- **Jerarquía de errores** (`src/errors.ts`):
  - `GeoEngineError` es la raíz.
  - `ClientClosedError`.
  - `ValidationError` y sus variantes: `DeviceIDRequired`, `GeofenceIDRequired`, `InvalidLatitude`, `InvalidLongitude`, `InvalidCoordinates`, `UserIDRequired`, `RuleIDRequired`, `RuleNameRequired`, `EmailRequired`, `RoleRequired`.
  - `TimeoutError`.
  - `APIError` (con `statusCode`) tiene dos ramas:
    - `SpatialAPIError`: `GeofenceNotFound`, `QuotaExceeded`, `Authentication`, `Forbidden`.
    - `APIServiceError`: `UserNotFound`, `RuleNotFound`, `UserAlreadyExists`, `InvitationPending`, `LastAdmin`, `LastSubject`.
  - Mapeo en `parseHttpError` (`http.ts:40`) y `parseApiServiceError` (`http.ts:124`).
- **Discrepancia README/código:** el README dice que `QuotaExceededError` cubre 402 o 429. El código solo lo mapea con 402 o el código `QUOTA_EXCEEDED` (`http.ts:103`). Un 429 que agota los reintentos queda como `APIError` genérico.
- **Mensajes de error:** si el cuerpo no es JSON, se incrusta tal cual en `.message` (`http.ts:63`, `:148`; prefijo en `errors.ts:106`). Una página HTML de proxy o una traza llegaría a quien llama y a sus logs. Los errores de red se relanzan crudos (`http.ts:355`), por lo que pueden incluir host y código (p. ej. `ECONNREFUSED`). No verificado en ejecución.
- **Cancelación:** ningún método público acepta `AbortSignal`. `close()` solo bloquea llamadas nuevas.
- **Logging, circuit breaker, caché:** ninguno.
- **`AsyncIngester`:**
  - Cada ping sale como una petición HTTP separada. No hay endpoint por lotes.
  - Los errores por ítem se tragan sin callback ni métrica (`.catch(() => {})`), así que la pérdida de datos es invisible.
  - `enqueue` devuelve `false` en silencio si la cola está llena o parada.
  - `client.close()` no detiene los ingesters ya creados.
  - Si el proceso muere, lo almacenado en el buffer se pierde.

## 7. Calidad

- **Pruebas:** Vitest ^2.1.8, sin archivo de config. 5 archivos, unos 64 `it` y 19 `describe`, sin `.only` ni `.skip`.
  - Usan servidores `node:http` reales en 127.0.0.1 como mock (`client.test.ts`, `spatial.test.ts`, `apiservice.test.ts`) y `vi.fn` para el ingester.
  - **No hay tests de `users.ts` ni de `geoidentity.ts`** a nivel de archivo propio. El servicio `UsersService` y `GeoIdentityService` se tocan, como mucho, de forma indirecta en `apiservice.test.ts`. No determinado el alcance exacto.
  - No hay pruebas de contrato (Pact/OpenAPI). El README las llama "integración" (`Readme.md:374`), lo que exagera.
  - **Cobertura: no determinado.** No hay script de cobertura ni `@vitest/coverage-v8`. No se ejecutaron los tests.
- **Typecheck:** `tsc --noEmit` con `strict`; solo incluye `src/`, así que los tests no se tipan.
- **Lint/formato:** ninguno configurado.
- **CI:** **no hay GitHub Actions** (sin `.github/`). Nada ejecuta tests, typecheck ni build en push o PR.
- **Publicación:** sin evidencia de proceso automático. `prepublishOnly` solo hace build, sin tests ni typecheck. **Sin provenance:** no hay CI ni campo `repository` (ver §2). Si se publica a mano: no determinado.
- **Versionado:** subidas manuales de `package.json`. Sin changesets ni CHANGELOG. Solo existe el tag `v1.1.3`; las versiones 2.0.0 y 2.1.0 no tienen tag.

## 8. Repositorio público

- **LICENSE:** MIT declarada en `package.json` y en el README, pero **no existe el archivo `LICENSE`**. GitHub no la detectará y el tarball (`files: ["dist"]`) tampoco la incluye.
- Ausentes: `SECURITY.md`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `CHANGELOG`, plantillas de issues y PR, `docs/` (previo a este informe).
- **README:** `Readme.md` y `README.es.md`, 391 líneas cada uno, duplicados a mano sin comprobación de sincronía. Secciones: características, instalación, quick start (ESM/CJS), Spatial, Users, GeoIdentity, creación de geocercas, `AsyncIngester`, configuración, errores, tests, licencia.
- Promesas del README:
  - "Cero dependencias runtime" y "ESM/CJS dual": **verificadas**.
  - "Compatible con Workers, Next.js, Bun, edge": **matizada**, ver §4.
  - "Seguridad nativa: timestamps anti-replay": el cliente solo envía `X-Request-Time`. La validación en servidor no está en este repo: no determinado.
  - "Paridad 1:1 con el SDK de Go v2.1.0" y "despacho <10 ms": no determinado (sin código Go ni benchmarks).
- **Ejemplos:** solo `examples/simulation.js`. La cabecera dice v2.0.0 (desactualizada). Apunta por defecto al host de producción y ejecuta una escritura (`createGeofence`) con una llave de marcador de posición.

## 9. Higiene de lo público

- **Hosts o servicios internos:** no se encontraron. Solo aparecen los hosts públicos por defecto (`http.ts:211-213`, `models.ts:23-35`, README), un host de dashboard en un fixture (`tests/apiservice.test.ts:165,174`) y `localhost` en tests y README.
- **Secretos:** no hay literales con forma de llave real.
  - Marcadores de posición con prefijo tipo `sk_test_`: `examples/simulation.js:7`, `tests/client.test.ts:71,80`.
  - Marcador tipo JWT: `tests/client.test.ts:103`.
  - Secreto de prueba para HMAC: `tests/client.test.ts:294`.
- **Archivos sensibles:** ni `.env`, `.pem`, `.key` ni `.npmrc` versionados. `.gitignore` cubre `.env`, `dist/`, `coverage/`, `.idea`, `.vscode`.
- **TODO/FIXME/HACK:** ninguno encontrado.
- **Dependencias privadas o por git/URL:** ninguna.
- **Mensajes de error con detalle de infraestructura:** cuerpos no JSON y errores de red crudos, ver §6.
- **Contenido del tarball:** `files: ["dist"]` excluye tests y ejemplos. Los `.map` incluyen `sourcesContent` (código ya público). Contenido exacto: no determinado sin `npm pack --dry-run`.
- **Metadatos de git:** los commits llevan el correo personal del autor, visible si el repo es público. Conviene decidirlo antes de publicar.
- **Fuga potencial de llave:** el getter `client.options` devuelve la configuración completa, incluida `apiKey` (`client.ts:91-93`, `http.ts:231-233`).

## 10. Cómo se extendería (GeoIdentity: navegador + servidor Node con middleware)

**Estado actual:** GeoIdentity ya existe como servicio servidor a servidor (`src/geoidentity.ts`), junto con Users, y se exporta desde `src/index.ts`. Faltan el cliente de navegador y el middleware.

**Convenciones a seguir** (inferidas de lo existente)
- Archivos planos `src/<dominio>.ts` con una clase `Service` construida con `(HttpClient, isClosed)`.
- Mapeo snake_case en el borde (`toRule`/`toWire`).
- Errores tipados en `errors.ts`, extendiendo `APIServiceError`.
- Exportaciones en `index.ts`, con `type` para los tipos.
- Tests en `tests/*.test.ts` con servidores `node:http`.
- Sección en `Readme.md` espejada en `README.es.md`.

**Puntos de encaje sin romper lo actual**
- **Navegador:**
  - La API key es secreta (`models.ts:7`), así que no puede ir al navegador. Debe usar `jwtToken` o una sesión mediante un proxy en el backend.
  - Código sin imports `node:*`, en `src/browser/` o `src/geoidentity/`.
  - `crypto.ts` usa `createHmac` síncrono. El camino de navegador debe omitir la firma o usar Web Crypto (asíncrono).
  - Hoy el `tsconfig` no incluye `lib` DOM, y `tsup` tiene una sola entrada sin `platform`.
- **`package.json`:** añadir subpath exports (`"./browser"`, `"./server"` o `"./middleware"`) y varias entradas de `tsup` con `platform` por entrada. El `"."` actual debe seguir intacto.
- **Middleware:** agnóstico del framework y sin dependencias runtime.
  - Tipos estructurales `(req, res, next)` para Express/Connect, más un handler basado en `Request`/`Response` de Fetch.
  - Tipos de frameworks, si se usan, como `peerDependencies` opcionales.
  - Hace falta una política de proxies de confianza para extraer la IP del cliente. Hoy no existe.
- **Brecha de producto:** el SDK solo tiene CRUD y `listUserRules`. No hay endpoint de "evaluar petición contra reglas". Los campos de IP, Tor o datacenter del modelo de reglas lo necesitarían. Si el api-service lo ofrece: no determinado.

## 11. Riesgos y deuda técnica (por importancia) y preguntas abiertas

**Riesgos, de mayor a menor**
1. **Diseño del HMAC** (`crypto.ts:11-18`, `http.ts:259-262`): el secreto es la propia llave, que además viaja en claro en `X-API-Key`. Firma solo el timestamp, no el cuerpo. No aporta nada que la cabecera de la llave no dé y no protege contra repetición por sí sola. `generateHMACSignature` se exporta públicamente.
2. **Fuga de la llave vía `client.options`** al registrar o serializar el cliente.
3. **Reintentos de POST no idempotentes** sin llave de idempotencia (duplicados de telemetría o geocercas).
4. **`AsyncIngester`:** una petición por ping, errores tragados, `close()` del cliente no lo detiene, pérdida silenciosa de datos.
5. **Sin CI, lint ni gate de cobertura:** `prepublishOnly` solo compila. Los tests no se tipan. Falta `LICENSE`, sin provenance.
6. **Cuerpos de error crudos** en `.message` y errores de red sin envolver.
7. **Metadatos de paquete incompletos** (`repository`, `bugs`, `homepage`, `publishConfig`), lo que bloquea provenance.
8. **Sin tests propios de Users y GeoIdentity**, módulos recién añadidos.
9. **Sin validación de esquema ni de `webhookUrl`** (`client.ts:151`); decisiones SSRF o de TLS quedan al servidor.
10. **`Invitation.inviteUrl`** lleva un token y no está documentada como secreta (`users.ts:184`).
11. **Deriva de versiones:** `2.1.0` en `package.json`, `User-Agent` fijo en `http.ts:21`, ejemplo con v2.0.0, tags solo hasta `v1.1.3`.
12. **Promesas de README no sostenidas:** edge y Workers, QuotaExceeded en 429, "integración", Go parity.
13. Menores: alias duplicados (`spatial`/`Spatial`), mensaje en español, casts `globalThis as ...` y `fetch: (...args: any[])` en `http.ts`, `baseUrl` que pisa URLs específicas, README duplicado a mano.

**Preguntas abiertas**
- ¿Está publicado `geo-engine-node@2.1.0` en npm? ¿Se publica a mano o hay otro pipeline fuera del repo?
- ¿Qué cobertura real tienen los tests? (No se ejecutaron.)
- ¿El servidor valida `X-Signature`, la ventana de `X-Request-Time` y enruta según `X-Geo-Environment`?
- ¿Existe un endpoint de evaluación de reglas en el api-service para GeoIdentity?
- ¿Qué productos "Core" y "GeoTarget" se esperaba cubrir? No hay rastro en el código.
- ¿Es intencional exponer el correo personal del autor en los commits?
- ¿Cuál es el contenido exacto del tarball (`npm pack --dry-run`)?
- ¿Funciona realmente en Workers, Bun o navegador? No se probó.

---

## Resumen (10 líneas)

1. Paquete único `geo-engine-node@2.1.0` (npm, ESM+CJS vía tsup, Node ≥18, TS 5.9), con cero dependencias runtime.
2. Cubre ingesta, geocercas, validación espacial, Users y GeoIdentity (solo CRUD de reglas). No hay "Core" ni "GeoTarget".
3. Transporte solo REST con `fetch`. Sin gRPC ni `.proto`. Depende de `node:crypto` y `node:timers`, así que no funciona en navegador ni edge sin compatibilidad Node.
4. Autenticación por `X-API-Key` más una firma HMAC débil (secreto = la llave, firma solo el timestamp). No lee variables de entorno y no hay staging.
5. Reintentos con backoff, pero también sobre POST no idempotentes. Sin `AbortSignal`, logging ni circuit breaker. El `AsyncIngester` pierde datos en silencio.
6. Hay 5 archivos de tests con mocks HTTP reales, pero sin cobertura medida y sin tests propios de Users y GeoIdentity.
7. No hay CI, lint, CHANGELOG ni provenance, y las versiones 2.x no están etiquetadas. La publicación es presumiblemente manual.
8. **Falta el archivo LICENSE** (MIT solo declarada), además de `SECURITY.md` y `CONTRIBUTING`. El README promete más de lo que el código cumple.
9. Higiene aceptable: sin secretos reales, hosts internos ni TODO. Vigilar los errores con cuerpo crudo, `client.options` con la llave y el correo personal en los commits.
10. GeoIdentity encaja con subpath exports (`./browser`, `./middleware`), builds por plataforma y JWT en navegador, sin tocar `"."`. Falta definir el endpoint de evaluación.
