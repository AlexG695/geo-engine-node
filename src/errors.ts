/**
 * Detailed error metadata returned by GeoEngine api-service.
 */
export interface SpatialErrorDetail {
  '@type'?: string;
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

/**
 * Base error class for all GeoEngine SDK exceptions.
 */
export class GeoEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoEngineError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an operation is attempted on a closed client instance.
 * Equivalent to Go's ErrClientClosed.
 */
export class ClientClosedError extends GeoEngineError {
  constructor(message = 'geoengine: client is closed') {
    super(message);
    this.name = 'ClientClosedError';
  }
}

/**
 * Error thrown when a client-side parameter validation fails.
 */
export class ValidationError extends GeoEngineError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when device_id is missing or empty.
 * Equivalent to Go's ErrDeviceIDRequired.
 */
export class DeviceIDRequiredError extends ValidationError {
  constructor(message = 'geoengine: device_id is required') {
    super(message);
    this.name = 'DeviceIDRequiredError';
  }
}

/**
 * Error thrown when a geofence_id is missing or empty.
 * Equivalent to Go's ErrGeofenceIDRequired.
 */
export class GeofenceIDRequiredError extends ValidationError {
  constructor(message = 'geoengine: geofence_id is required') {
    super(message);
    this.name = 'GeofenceIDRequiredError';
  }
}

/**
 * Error thrown when latitude falls outside the valid range [-90, 90].
 * Equivalent to Go's ErrInvalidLatitude.
 */
export class InvalidLatitudeError extends ValidationError {
  constructor(message = 'geoengine: latitude must be between -90 and 90 degrees') {
    super(message);
    this.name = 'InvalidLatitudeError';
  }
}

/**
 * Error thrown when longitude falls outside the valid range [-180, 180].
 * Equivalent to Go's ErrInvalidLongitude.
 */
export class InvalidLongitudeError extends ValidationError {
  constructor(message = 'geoengine: longitude must be between -180 and 180 degrees') {
    super(message);
    this.name = 'InvalidLongitudeError';
  }
}

/**
 * Error thrown when coordinate polygon validation fails.
 * Equivalent to Go's ErrInvalidCoordinates.
 */
export class InvalidCoordinatesError extends ValidationError {
  constructor(message = 'geoengine: at least 3 coordinate pairs are required for a polygon') {
    super(message);
    this.name = 'InvalidCoordinatesError';
  }
}

/**
 * Represents an HTTP error returned by the GeoEngine REST or Management API.
 * Equivalent to Go's APIError.
 */
export class APIError extends GeoEngineError {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`geoengine: API error (status ${statusCode}): ${message}`);
    this.name = 'APIError';
    this.statusCode = statusCode;
  }
}

/**
 * Represents a structured error returned by GeoEngine api-service.
 * Equivalent to Go's SpatialAPIError.
 */
export class SpatialAPIError extends APIError {
  readonly code: string;
  readonly statusText?: string;
  readonly details: SpatialErrorDetail[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    statusText?: string,
    details: SpatialErrorDetail[] = []
  ) {
    const formattedMessage = code
      ? `geoengine: spatial API error (status ${statusCode}, code ${code}): ${message}`
      : `geoengine: spatial API error (status ${statusCode}): ${message}`;
    super(statusCode, formattedMessage);
    this.name = 'SpatialAPIError';
    this.code = code;
    this.statusText = statusText;
    this.details = details;
  }

  /**
   * Returns true if the error indicates the geofence or resource was not found.
   */
  isNotFound(): boolean {
    return (
      this.statusCode === 204 ||
      this.statusCode === 404 ||
      this.code === 'NOT_FOUND'
    );
  }

  /**
   * Returns true if the error indicates quota limit was hit.
   */
  isQuotaExceeded(): boolean {
    return (
      this.statusCode === 402 ||
      this.code === 'QUOTA_EXCEEDED'
    );
  }

  /**
   * Returns true if authentication failed.
   */
  isUnauthorized(): boolean {
    return (
      this.statusCode === 401 ||
      this.code === 'UNAUTHORIZED' ||
      this.code === 'MISSING_API_KEY' ||
      this.code === 'MISSING_ORGANIZATION'
    );
  }

  /**
   * Returns true if access to the requested resource is forbidden.
   */
  isForbidden(): boolean {
    return (
      this.statusCode === 403 ||
      this.code === 'FORBIDDEN'
    );
  }
}

/**
 * Specific error thrown when a geofence is not found (204 or 404).
 * Equivalent to Go's ErrGeofenceNotFound.
 */
export class GeofenceNotFoundError extends SpatialAPIError {
  constructor(message = 'geofence not found', statusCode = 204, details: SpatialErrorDetail[] = []) {
    super(statusCode, 'NOT_FOUND', message, 'Not Found', details);
    this.name = 'GeofenceNotFoundError';
  }
}

/**
 * Specific error thrown when request quota limit is exceeded (HTTP 402 or 429).
 * Equivalent to Go's ErrQuotaExceeded.
 */
export class QuotaExceededError extends SpatialAPIError {
  constructor(message = 'request quota exceeded', statusCode = 402, details: SpatialErrorDetail[] = []) {
    super(statusCode, 'QUOTA_EXCEEDED', message, 'Payment Required', details);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Specific error thrown when API authentication fails (HTTP 401).
 * Equivalent to Go's ErrUnauthorized.
 */
export class AuthenticationError extends SpatialAPIError {
  constructor(message = 'unauthorized API request', statusCode = 401, details: SpatialErrorDetail[] = []) {
    super(statusCode, 'UNAUTHORIZED', message, 'Unauthorized', details);
    this.name = 'AuthenticationError';
  }
}

/**
 * Specific error thrown when access is forbidden (HTTP 403).
 * Equivalent to Go's ErrForbidden.
 */
export class ForbiddenError extends SpatialAPIError {
  constructor(message = 'access forbidden', statusCode = 403, details: SpatialErrorDetail[] = []) {
    super(statusCode, 'FORBIDDEN', message, 'Forbidden', details);
    this.name = 'ForbiddenError';
  }
}

/**
 * Error thrown when a network request exceeds its deadline or timeout limit.
 */
export class TimeoutError extends GeoEngineError {
  constructor(timeoutMs: number) {
    super(`geoengine: request exceeded the timeout limit of ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a user ID is missing or empty.
 * Equivalent to Go's ErrUserIDRequired.
 */
export class UserIDRequiredError extends ValidationError {
  constructor(message = 'geoengine: user_id is required') {
    super(message);
    this.name = 'UserIDRequiredError';
  }
}

/**
 * Error thrown when a GeoIdentity rule ID is missing or empty.
 * Equivalent to Go's ErrRuleIDRequired.
 */
export class RuleIDRequiredError extends ValidationError {
  constructor(message = 'geoengine: rule_id is required') {
    super(message);
    this.name = 'RuleIDRequiredError';
  }
}

/**
 * Error thrown when a GeoIdentity rule name is missing or empty.
 * Equivalent to Go's ErrRuleNameRequired.
 */
export class RuleNameRequiredError extends ValidationError {
  constructor(message = 'geoengine: rule name is required') {
    super(message);
    this.name = 'RuleNameRequiredError';
  }
}

/**
 * Error thrown when an invitation email is missing or empty.
 * Equivalent to Go's ErrEmailRequired.
 */
export class EmailRequiredError extends ValidationError {
  constructor(message = 'geoengine: email is required') {
    super(message);
    this.name = 'EmailRequiredError';
  }
}

/**
 * Error thrown when a role is missing or empty.
 * Equivalent to Go's ErrRoleRequired.
 */
export class RoleRequiredError extends ValidationError {
  constructor(message = 'geoengine: role is required') {
    super(message);
    this.name = 'RoleRequiredError';
  }
}

/**
 * Structured error returned by the api-service Users and GeoIdentity endpoints.
 * Equivalent to Go's APIServiceError. Branch on the subclasses (for example
 * UserNotFoundError) or on `code`.
 */
export class APIServiceError extends APIError {
  /** Machine-readable reason, e.g. "USER_NOT_FOUND". Empty when the API sent none. */
  readonly code: string;
  /** Message returned by the API, without the SDK prefix. */
  readonly apiMessage: string;
  readonly details: SpatialErrorDetail[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: SpatialErrorDetail[] = []
  ) {
    super(statusCode, message);
    this.message = code
      ? `geoengine: api-service error (status ${statusCode}, code ${code}): ${message}`
      : `geoengine: api-service error (status ${statusCode}): ${message}`;
    this.name = 'APIServiceError';
    this.code = code;
    this.apiMessage = message;
    this.details = details;
  }
}

/**
 * The user does not exist in the organization (or its access was revoked).
 * Equivalent to Go's ErrUserNotFound.
 */
export class UserNotFoundError extends APIServiceError {
  constructor(message = 'user not found in organization', statusCode = 404, code = 'USER_NOT_FOUND', details: SpatialErrorDetail[] = []) {
    super(statusCode, code, message, details);
    this.name = 'UserNotFoundError';
  }
}

/**
 * The GeoIdentity rule does not exist.
 * Equivalent to Go's ErrRuleNotFound.
 */
export class RuleNotFoundError extends APIServiceError {
  constructor(message = 'geoidentity rule not found', statusCode = 404, code = 'RULE_NOT_FOUND', details: SpatialErrorDetail[] = []) {
    super(statusCode, code, message, details);
    this.name = 'RuleNotFoundError';
  }
}

/**
 * The invited email already belongs to the organization.
 * Equivalent to Go's ErrUserAlreadyExists.
 */
export class UserAlreadyExistsError extends APIServiceError {
  constructor(message = 'user already belongs to the organization', statusCode = 409, code = 'USER_ALREADY_EXISTS', details: SpatialErrorDetail[] = []) {
    super(statusCode, code, message, details);
    this.name = 'UserAlreadyExistsError';
  }
}

/**
 * A pending invitation already exists for the email.
 * Equivalent to Go's ErrInvitationPending.
 */
export class InvitationPendingError extends APIServiceError {
  constructor(message = 'a pending invitation already exists for this email', statusCode = 409, code = 'INVITATION_PENDING', details: SpatialErrorDetail[] = []) {
    super(statusCode, code, message, details);
    this.name = 'InvitationPendingError';
  }
}

/**
 * The operation would leave the organization without an admin.
 * Equivalent to Go's ErrLastAdmin.
 */
export class LastAdminError extends APIServiceError {
  constructor(message = 'organization must keep at least one admin', statusCode = 409, code = 'LAST_ADMIN', details: SpatialErrorDetail[] = []) {
    super(statusCode, code, message, details);
    this.name = 'LastAdminError';
  }
}

/**
 * The operation would leave a rule without assigned subjects.
 * Equivalent to Go's ErrLastSubject.
 */
export class LastSubjectError extends APIServiceError {
  constructor(message = 'rule must keep at least one assigned subject', statusCode = 409, code = 'LAST_SUBJECT', details: SpatialErrorDetail[] = []) {
    super(statusCode, code, message, details);
    this.name = 'LastSubjectError';
  }
}
