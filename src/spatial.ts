import type { HttpClient } from './http.js';
import {
  SpatialGeneralResult,
  SpatialValidationResult,
  type SpatialGeneralRequest,
  type SpatialGeneralResultData,
  type SpatialValidationRequest,
  type SpatialValidationResultData,
} from './models.js';
import { validateCoordinates, validateGeofenceId } from './validation.js';

/**
 * Handles point-in-polygon and spatial validation against the GeoEngine api-service.
 * Equivalent to Go's SpatialService.
 */
export class SpatialService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Convenience method to check if coordinates fall within a specific geofence.
   *
   * @param geofenceId Unique identifier of the geofence
   * @param lat Decimal latitude [-90, 90]
   * @param lng Decimal longitude [-180, 180]
   * @returns SpatialValidationResult
   */
  async validatePoint(
    geofenceId: string,
    lat: number,
    lng: number
  ): Promise<SpatialValidationResult> {
    const validId = validateGeofenceId(geofenceId);
    validateCoordinates(lat, lng);

    return this.validateLocation({
      geofenceId: validId,
      latitude: lat,
      longitude: lng,
    });
  }

  /**
   * Checks if coordinates fall inside the specified geofence using the api-service.
   *
   * @param req SpatialValidationRequest containing geofenceId, latitude, and longitude
   * @returns SpatialValidationResult
   */
  async validateLocation(
    req: SpatialValidationRequest
  ): Promise<SpatialValidationResult> {
    const validId = validateGeofenceId(req.geofenceId);
    validateCoordinates(req.latitude, req.longitude);

    const endpoint = `${this.http.options.apiServiceUrl.replace(/\/+$/, '')}/api/spatial/validate`;

    const payload = {
      geofence_id: validId,
      latitude: req.latitude,
      longitude: req.longitude,
    };

    const rawData = await this.http.request<SpatialValidationResultData>({
      endpoint,
      method: 'POST',
      body: payload,
      isSpatial: true,
    });

    return new SpatialValidationResult(rawData);
  }

  /**
   * Checks whether coordinates intersect any geofence belonging to the organization.
   *
   * @param lat Decimal latitude [-90, 90]
   * @param lng Decimal longitude [-180, 180]
   * @returns SpatialGeneralResult
   */
  async validateGeneral(
    lat: number,
    lng: number
  ): Promise<SpatialGeneralResult> {
    validateCoordinates(lat, lng);

    return this.validateGeneralLocation({
      latitude: lat,
      longitude: lng,
    });
  }

  /**
   * Checks whether coordinates intersect any geofence using the api-service.
   *
   * @param req SpatialGeneralRequest containing latitude and longitude
   * @returns SpatialGeneralResult
   */
  async validateGeneralLocation(
    req: SpatialGeneralRequest
  ): Promise<SpatialGeneralResult> {
    validateCoordinates(req.latitude, req.longitude);

    const endpoint = `${this.http.options.apiServiceUrl.replace(/\/+$/, '')}/api/spatial/validate-general`;

    const payload = {
      latitude: req.latitude,
      longitude: req.longitude,
    };

    const rawData = await this.http.request<SpatialGeneralResultData>({
      endpoint,
      method: 'POST',
      body: payload,
      isSpatial: true,
    });

    return new SpatialGeneralResult(rawData);
  }

  /**
   * Initializes a fluent query builder for spatial coordinate validation.
   *
   * @param lat Decimal latitude
   * @param lng Decimal longitude
   * @returns SpatialCheckBuilder
   */
  check(lat: number, lng: number): SpatialCheckBuilder {
    return new SpatialCheckBuilder(this, lat, lng);
  }
}

/**
 * Fluent query builder for spatial evaluation operations.
 * Equivalent to Go's SpatialCheckBuilder.
 */
export class SpatialCheckBuilder {
  constructor(
    private readonly service: SpatialService,
    private readonly lat: number,
    private readonly lng: number
  ) {}

  /**
   * Configures validation targeting a specific geofence ID.
   */
  inGeofence(geofenceId: string): SingleGeofenceCheck {
    return new SingleGeofenceCheck(this.service, geofenceId, this.lat, this.lng);
  }

  /**
   * Configures validation against all organization geofences.
   */
  inAllGeofences(): GeneralGeofenceCheck {
    return new GeneralGeofenceCheck(this.service, this.lat, this.lng);
  }
}

/**
 * Evaluates coordinate containment inside a specific geofence.
 * Equivalent to Go's SingleGeofenceCheck.
 */
export class SingleGeofenceCheck {
  constructor(
    private readonly service: SpatialService,
    private readonly geofenceId: string,
    private readonly lat: number,
    private readonly lng: number
  ) {}

  /**
   * Performs the single geofence spatial query.
   */
  async execute(): Promise<SpatialValidationResult> {
    return this.service.validatePoint(this.geofenceId, this.lat, this.lng);
  }

  /**
   * Alias for execute().
   */
  async executeSingle(): Promise<SpatialValidationResult> {
    return this.execute();
  }

  /**
   * Alias for execute().
   */
  async validate(): Promise<SpatialValidationResult> {
    return this.execute();
  }
}

/**
 * Evaluates coordinate containment across all organization geofences.
 * Equivalent to Go's GeneralGeofenceCheck.
 */
export class GeneralGeofenceCheck {
  constructor(
    private readonly service: SpatialService,
    private readonly lat: number,
    private readonly lng: number
  ) {}

  /**
   * Performs the general spatial query against all organization geofences.
   */
  async execute(): Promise<SpatialGeneralResult> {
    return this.service.validateGeneral(this.lat, this.lng);
  }

  /**
   * Alias for execute().
   */
  async executeGeneral(): Promise<SpatialGeneralResult> {
    return this.execute();
  }

  /**
   * Alias for execute().
   */
  async validate(): Promise<SpatialGeneralResult> {
    return this.execute();
  }
}
