import { GeoEngine } from './client.js';

// Re-export client
export { GeoEngine, GeoEngine as Client } from './client.js';

// Re-export Spatial module and query builders
export {
  SpatialService,
  SpatialCheckBuilder,
  SingleGeofenceCheck,
  GeneralGeofenceCheck,
} from './spatial.js';

// Re-export Async Ingestion
export { AsyncIngester, type IngesterClient } from './ingester.js';

// Re-export models and types
export {
  SpatialValidationResult,
  SpatialGeneralResult,
  type SpatialValidationResultData,
  type SpatialGeneralResultData,
  type GeoEngineOptions,
  type LocationPing,
  type IngestResponse,
  type GeofenceRequest,
  type SpatialValidationRequest,
  type SpatialGeneralRequest,
  type GeofenceMatch,
} from './models.js';

export { type HttpClientConfig } from './http.js';

// Re-export errors
export {
  GeoEngineError,
  ClientClosedError,
  ValidationError,
  DeviceIDRequiredError,
  GeofenceIDRequiredError,
  InvalidLatitudeError,
  InvalidLongitudeError,
  InvalidCoordinatesError,
  APIError,
  SpatialAPIError,
  GeofenceNotFoundError,
  QuotaExceededError,
  AuthenticationError,
  ForbiddenError,
  TimeoutError,
  type SpatialErrorDetail,
} from './errors.js';

// Re-export validation utilities
export {
  validateCoordinates,
  validateDeviceId,
  validateGeofenceId,
  validateAndNormalizePolygon,
} from './validation.js';

// Re-export HMAC signature utility
export { generateHMACSignature } from './crypto.js';

// Default export
export default GeoEngine;
