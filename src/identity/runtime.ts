import { GeoEngineError } from '../errors.js';

/**
 * Ensures GeoIdentity /v1 evaluation APIs run only in server runtimes.
 * /v1 requires a secret API key in Authorization: Bearer and does not allow browser CORS requests.
 */
export function assertServerEnvironment(): void {
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
    throw new GeoEngineError(
      'geoengine/identity: /v1 es solo de servidor y no puede usarse en un navegador porque la API key es secreta y /v1 no admite peticiones desde navegador (CORS).'
    );
  }
}
