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
