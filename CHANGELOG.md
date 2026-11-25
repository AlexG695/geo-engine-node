# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [3.0.0-rc.1] - 2026-11-24

Release candidate, published under the npm `next` dist-tag. The GeoIdentity module is **experimental**: its `/v1/evaluate` contract is a draft and it is not recommended for production.

### BREAKING

- **`client.options.apiKey` no longer exists** (it is also removed from the `HttpClientConfig` type). The key is stored in a private field and redacted in `util.inspect`, `JSON.stringify` and error messages. *Migration:* keep the key in your own variable (for example `process.env.GEOENGINE_API_KEY`) instead of reading it back from `client.options`.
- **Service URLs must use `https`** (`baseUrl`, `managementUrl`, `ingestUrl`, `apiServiceUrl`), except loopback (`localhost`, `127.0.0.1`, `::1`). Otherwise the constructor throws `ValidationError` before any request. *Migration:* point staging/test environments to an https URL or to a loopback address.
- **Redirects are no longer followed** (`redirect: 'manual'`): a 3xx response now reaches your code as an error instead of being followed silently, so credentials cannot be forwarded to another origin. *Migration:* configure the final URL directly.
- **Minimum Node.js is 20** (`engines.node >=20.0.0`); the CI matrix is Node 20 and 22.
- Identity types `Location`, `Context` and `Subject` are exported as `IdentityLocation`, `IdentityContext` and `IdentitySubject` (no aliases).

### Security

- Error messages from legacy routes no longer include the API key or the JWT, even if the server echoes them in the response body.
- Published sourcemaps no longer contain absolute local paths.

### Added
- Server-only GeoIdentity runtime evaluation via `client.identity.evaluate({ scope, subject, context })` against `POST /v1/evaluate`, using `Authorization: Bearer <apiKey>` and automatic `X-Request-Id` propagation.
- New subpath export `geo-engine-node/identity` (ESM & CJS) providing Express/Connect-compatible `identityGuard({ client, scope, getSubject, getContext, failOpen, ... })` with mandatory `failOpen`, `CHALLENGE` handling, synthetic fallback decisions (`meta.source = 'sdk_fallback'`), and browser runtime protection.
- Typed identity errors `IdentityTransientError`, `IdentityIntegrationError`, and `isTransient(err)`, with 500ms default total deadline and single jittered retry for transient failures (including `Retry-After` handling on 429).
- Security hardening: moved `apiKey` to a private `#` field, removed it from `client.options`, and redacted secrets in `util.inspect`, `JSON.stringify`, and error messages.
- Repository hygiene: `LICENSE` (MIT, Copyright (c) 2026 Geo-Engine Team), CI and security workflows, Dependabot, `CODEOWNERS`, `SECURITY.md`, and a tag-triggered release workflow publishing with npm trusted publishing (provenance).

### Changed
- Build uses code splitting so `.` and `./identity` share a single set of error classes per format; `IdentityIntegrationError instanceof GeoEngineError` is now `true` within each format. Identity errors expose a stable `err.code` (`IDENTITY_TRANSIENT`, `IDENTITY_INTEGRATION`), which is the contract across ESM and CJS (classes are not shared between formats).
- Server error bodies are scrubbed of the API key and JWT before becoming error messages; tests assert that no secret appears in `JSON.stringify`, `util.inspect` or messages of clients and errors.
- `User-Agent` version is injected from `package.json` at build time.
- Updated `Readme.md` and `README.es.md`: identity docs, `failOpen` semantics, aligned retry/error/HMAC/runtime notes; examples read the key from `process.env.GEOENGINE_API_KEY` with an explicit check.
