# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Server-only GeoIdentity runtime evaluation via `client.identity.evaluate({ scope, subject, context })` against `POST /v1/evaluate`, using `Authorization: Bearer <apiKey>` and automatic `X-Request-Id` propagation.
- New subpath export `geo-engine-node/identity` (ESM & CJS) providing Express/Connect-compatible `identityGuard({ client, scope, getSubject, getContext, failOpen, ... })` with mandatory `failOpen`, `CHALLENGE` handling, synthetic fallback decisions (`meta.source = 'sdk_fallback'`), and browser runtime protection.
- Typed identity errors `IdentityTransientError`, `IdentityIntegrationError`, and `isTransient(err)`, with 500ms default total deadline and single jittered retry for transient failures (including `Retry-After` handling on 429).
- Security hardening: moved `apiKey` to a private `#` field, removed it from `client.options`, and redacted secrets in `util.inspect`, `JSON.stringify`, and error messages.
- Repository hygiene: added `LICENSE` (MIT) and GitHub Actions workflows for CI and npm provenance publishing.

### Changed
- BREAKING: identity types `Location`, `Context` and `Subject` are now exported as `IdentityLocation`, `IdentityContext` and `IdentitySubject` (no aliases).
- Server error bodies are scrubbed of the API key and JWT before being turned into error messages; tests assert no secret appears in `JSON.stringify`, `util.inspect` or messages of clients and errors.
- Minimum Node.js is now 20 (`engines.node >=20.0.0`); CI matrix is Node 20 and 22.
- Build now uses code splitting so `.` and `./identity` share a single set of error classes per format (ESM, CJS); identity errors expose a stable `code` (`IDENTITY_TRANSIENT`, `IDENTITY_INTEGRATION`), which is the cross-format contract.
- Service URLs (`baseUrl`, `managementUrl`, `ingestUrl`, `apiServiceUrl`) must be `https` (plain `http` only for `localhost`, `127.0.0.1`, `::1`); otherwise the constructor throws `ValidationError`. Redirects are no longer followed (`redirect: 'manual'`).
- `User-Agent` version is injected from `package.json` at build time.
- README examples read the API key from `process.env.GEOENGINE_API_KEY`.
- Updated `Readme.md` and `README.es.md` to document `client.identity.evaluate`, `identityGuard`, `failOpen` semantics, and to align documented retry, error mapping, HMAC, and runtime compatibility behavior with the actual implementation.
