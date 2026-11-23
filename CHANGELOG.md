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
- Updated `Readme.md` and `README.es.md` to document `client.identity.evaluate`, `identityGuard`, `failOpen` semantics, and to align documented retry, error mapping, HMAC, and runtime compatibility behavior with the actual implementation.
