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

// Re-export Users module
export {
  UsersService,
  Roles,
  UserStatus,
  type User,
  type Role,
  type InviteUserRequest,
  type Invitation,
} from './users.js';

// Re-export GeoIdentity module
export {
  GeoIdentityService,
  RuleActions,
  SubjectTypes,
  polygonFromLatLng,
  type RuleAction,
  type SubjectType,
  type SubjectAssignment,
  type GeoLimit,
  type Rule,
  type CreateRuleRequest,
  type UpdateRuleRequest,
  type ListRulesOptions,
} from './geoidentity.js';

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
  UserIDRequiredError,
  RuleIDRequiredError,
  RuleNameRequiredError,
  EmailRequiredError,
  RoleRequiredError,
  APIServiceError,
  UserNotFoundError,
  RuleNotFoundError,
  UserAlreadyExistsError,
  InvitationPendingError,
  LastAdminError,
  LastSubjectError,
  type SpatialErrorDetail,
} from './errors.js';

// Re-export validation utilities
export {
  validateCoordinates,
  validateDeviceId,
  validateGeofenceId,
  validateAndNormalizePolygon,
} from './validation.js';

// Re-export GeoIdentity runtime evaluation (/v1/evaluate)
export { IdentityService, type IdentityServiceConfig } from './identity/evaluate.js';
export {
  IdentityTransientError,
  IdentityIntegrationError,
  isTransient,
  type IdentityErrorFields,
} from './identity/errors.js';
export type {
  LocationSource,
  IdentityLocation,
  IdentityContext,
  IdentitySubject,
  EvaluateRequest,
  EvaluateOptions,
  KnownDecision,
  Decision,
  EvaluateReason,
  KnownSignal,
  EvaluateSignal,
  RuleRef,
  ShadowMatch,
  Challenge,
  MetaSource,
  ReputationStatus,
  EvaluateMeta,
  EvaluateResponse,
  IdentityTransientReason,
  FallbackReason,
  IdentityIntegrationReason,
  FallbackDecision,
  IdentityDecision,
} from './identity/types.js';

// Re-export HMAC signature utility
export { generateHMACSignature } from './crypto.js';

// Default export
export default GeoEngine;
