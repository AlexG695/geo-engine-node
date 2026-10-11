import {
  DeviceIDRequiredError,
  GeofenceIDRequiredError,
  InvalidCoordinatesError,
  InvalidLatitudeError,
  InvalidLongitudeError,
  ValidationError,
} from './errors.js';

/**
 * Validates that latitude is between -90 and 90, and longitude is between -180 and 180 degrees.
 * Equivalent to Go's ValidateCoordinates(lat, lng).
 */
export function validateCoordinates(lat: number, lng: number): void {
  if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new InvalidLatitudeError();
  }
  if (typeof lng !== 'number' || Number.isNaN(lng) || lng < -180 || lng > 180) {
    throw new InvalidLongitudeError();
  }
}

/**
 * Validates that device ID is provided and not empty.
 */
export function validateDeviceId(deviceId: string): string {
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw new DeviceIDRequiredError();
  }
  return deviceId.trim();
}

/**
 * Validates that geofence ID is provided and not empty.
 */
export function validateGeofenceId(geofenceId: string): string {
  if (!geofenceId || typeof geofenceId !== 'string' || geofenceId.trim() === '') {
    throw new GeofenceIDRequiredError();
  }
  return geofenceId.trim();
}

/**
 * Validates coordinate array of [lat, lng] pairs for polygon creation,
 * converts to GeoJSON [lng, lat] and ensures the linear ring is closed.
 */
export function validateAndNormalizePolygon(
  coordinates: Array<[number, number] | number[]>
): [number, number][] {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new InvalidCoordinatesError();
  }

  const polygon: [number, number][] = [];
  for (const p of coordinates) {
    if (!Array.isArray(p) || p.length !== 2) {
      throw new ValidationError(
        `geoengine: invalid coordinate format: ${JSON.stringify(p)} (expected [lat, lng])`
      );
    }
    const lat = p[0]!;
    const lng = p[1]!;
    validateCoordinates(lat, lng);
    // In GeoJSON, order is [longitude, latitude]
    polygon.push([lng, lat]);
  }

  // Ensure polygon is closed: first point must equal last point
  const first = polygon[0]!;
  const last = polygon[polygon.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    polygon.push([first[0], first[1]]);
  }

  return polygon;
}
