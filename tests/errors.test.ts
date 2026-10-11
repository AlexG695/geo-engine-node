import { describe, expect, it } from 'vitest';
import {
  APIError,
  AuthenticationError,
  ClientClosedError,
  DeviceIDRequiredError,
  ForbiddenError,
  GeofenceIDRequiredError,
  GeofenceNotFoundError,
  GeoEngineError,
  InvalidCoordinatesError,
  InvalidLatitudeError,
  InvalidLongitudeError,
  QuotaExceededError,
  SpatialAPIError,
  TimeoutError,
  ValidationError,
  validateAndNormalizePolygon,
  validateCoordinates,
  validateDeviceId,
  validateGeofenceId,
} from '../src/index.js';

describe('Error Hierarchy & Validation Helpers', () => {
  it('properly formats APIError strings', () => {
    const err = new APIError(404, '{"error":"not found"}');
    expect(err.message).toBe('geoengine: API error (status 404): {"error":"not found"}');
    expect(err.statusCode).toBe(404);
    expect(err).toBeInstanceOf(GeoEngineError);
  });

  it('evaluates SpatialAPIError helper methods', () => {
    const notFound = new SpatialAPIError(404, 'NOT_FOUND', 'geofence missing');
    expect(notFound.isNotFound()).toBe(true);
    expect(notFound.isQuotaExceeded()).toBe(false);

    const quota = new SpatialAPIError(402, 'QUOTA_EXCEEDED', 'limit reached');
    expect(quota.isQuotaExceeded()).toBe(true);
    expect(quota.isUnauthorized()).toBe(false);

    const unauth = new SpatialAPIError(401, 'UNAUTHORIZED', 'bad key');
    expect(unauth.isUnauthorized()).toBe(true);

    const forbidden = new SpatialAPIError(403, 'FORBIDDEN', 'forbidden access');
    expect(forbidden.isForbidden()).toBe(true);
  });

  it('instantiates specialized semantic errors', () => {
    expect(new GeofenceNotFoundError()).toBeInstanceOf(SpatialAPIError);
    expect(new QuotaExceededError()).toBeInstanceOf(SpatialAPIError);
    expect(new AuthenticationError()).toBeInstanceOf(SpatialAPIError);
    expect(new ForbiddenError()).toBeInstanceOf(SpatialAPIError);
    expect(new TimeoutError(5000)).toBeInstanceOf(GeoEngineError);
    expect(new ClientClosedError()).toBeInstanceOf(GeoEngineError);
  });

  describe('validateCoordinates', () => {
    it('accepts valid coordinates', () => {
      expect(() => validateCoordinates(19.4326, -99.1332)).not.toThrow();
      expect(() => validateCoordinates(0, 0)).not.toThrow();
      expect(() => validateCoordinates(-90, -180)).not.toThrow();
      expect(() => validateCoordinates(90, 180)).not.toThrow();
    });

    it('rejects invalid latitudes', () => {
      expect(() => validateCoordinates(91, 0)).toThrow(InvalidLatitudeError);
      expect(() => validateCoordinates(-91, 0)).toThrow(InvalidLatitudeError);
      expect(() => validateCoordinates(NaN, 0)).toThrow(InvalidLatitudeError);
    });

    it('rejects invalid longitudes', () => {
      expect(() => validateCoordinates(0, 181)).toThrow(InvalidLongitudeError);
      expect(() => validateCoordinates(0, -181)).toThrow(InvalidLongitudeError);
      expect(() => validateCoordinates(0, NaN)).toThrow(InvalidLongitudeError);
    });
  });

  describe('validateDeviceId and validateGeofenceId', () => {
    it('accepts non-empty trimmed strings', () => {
      expect(validateDeviceId('truck-01')).toBe('truck-01');
      expect(validateDeviceId('  car-99  ')).toBe('car-99');
      expect(validateGeofenceId('geo-1')).toBe('geo-1');
      expect(validateGeofenceId('  geo-2  ')).toBe('geo-2');
    });

    it('rejects empty or whitespace-only IDs', () => {
      expect(() => validateDeviceId('')).toThrow(DeviceIDRequiredError);
      expect(() => validateDeviceId('   ')).toThrow(DeviceIDRequiredError);
      expect(() => validateGeofenceId('')).toThrow(GeofenceIDRequiredError);
      expect(() => validateGeofenceId('   ')).toThrow(GeofenceIDRequiredError);
    });
  });

  describe('validateAndNormalizePolygon', () => {
    it('normalizes, validates coordinates, and auto-closes polygon', () => {
      const input: [number, number][] = [
        [19.4, -99.1],
        [19.5, -99.1],
        [19.5, -99.2],
      ];

      const polygon = validateAndNormalizePolygon(input);
      // Converts [lat, lng] to GeoJSON [lng, lat] and closes ring
      expect(polygon).toEqual([
        [-99.1, 19.4],
        [-99.1, 19.5],
        [-99.2, 19.5],
        [-99.1, 19.4],
      ]);
    });

    it('does not duplicate last point if already closed', () => {
      const input: [number, number][] = [
        [10, 20],
        [11, 20],
        [11, 21],
        [10, 20],
      ];

      const polygon = validateAndNormalizePolygon(input);
      expect(polygon).toHaveLength(4);
      expect(polygon[0]).toEqual([20, 10]);
      expect(polygon[3]).toEqual([20, 10]);
    });

    it('throws InvalidCoordinatesError if fewer than 3 coordinates', () => {
      expect(() =>
        validateAndNormalizePolygon([
          [10, 20],
          [11, 20],
        ])
      ).toThrow(InvalidCoordinatesError);
    });

    it('throws ValidationError if coordinate point format is invalid', () => {
      expect(() =>
        validateAndNormalizePolygon([
          [10, 20, 30] as any,
          [11, 20],
          [11, 21],
        ])
      ).toThrow(ValidationError);
    });
  });
});
