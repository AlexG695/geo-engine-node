import { ClientClosedError, ValidationError } from './errors.js';
import { HttpClient, type HttpClientConfig } from './http.js';
import { AsyncIngester } from './ingester.js';
import type {
  GeoEngineOptions,
  SpatialGeneralRequest,
  SpatialGeneralResult,
  SpatialValidationRequest,
  SpatialValidationResult,
} from './models.js';
import { SpatialService } from './spatial.js';
import {
  validateAndNormalizePolygon,
  validateDeviceId,
} from './validation.js';

/**
 * GeoEngine Client for interacting with GeoEngine APIs over HTTP REST.
 * Equivalent to Go's Client struct.
 */
export class GeoEngine {
  private readonly http: HttpClient;
  private isClosed = false;

  /**
   * Spatial provides point-in-polygon querying and geofence validation capabilities.
   */
  readonly spatial: SpatialService;

  /**
   * Alias for spatial (to maintain exact casing compatibility with Go client.Spatial).
   */
  readonly Spatial: SpatialService;

  /**
   * Initializes a new GeoEngine client instance.
   *
   * @param apiKey Your GeoEngine API Key (required)
   * @param options Optional configuration parameters
   */
  constructor(apiKeyOrOptions: string | GeoEngineOptions, maybeOptions: GeoEngineOptions = {}) {
    let resolvedOptions: GeoEngineOptions;

    if (typeof apiKeyOrOptions === 'string') {
      resolvedOptions = { ...maybeOptions, apiKey: apiKeyOrOptions };
    } else if (typeof apiKeyOrOptions === 'object' && apiKeyOrOptions !== null) {
      resolvedOptions = { ...apiKeyOrOptions };
    } else {
      resolvedOptions = {};
    }

    if (!resolvedOptions.apiKey || resolvedOptions.apiKey.trim() === '') {
      throw new ValidationError('GeoEngine: API Key es requerida.');
    }

    this.http = new HttpClient(resolvedOptions);
    this.spatial = new SpatialService(this.http);
    this.Spatial = this.spatial;
  }

  /**
   * Current configuration options.
   */
  get options(): Readonly<HttpClientConfig> {
    return this.http.options;
  }

  /**
   * Sends device coordinates over HTTP REST.
   * Equivalent to Go's Client.SendLocation.
   *
   * @param deviceId Unique vehicle/device identifier
   * @param lat Decimal latitude
   * @param lng Decimal longitude
   */
  async sendLocation(deviceId: string, lat: number, lng: number): Promise<void> {
    if (this.isClosed) {
      throw new ClientClosedError();
    }

    const validId = validateDeviceId(deviceId);

    const payload = {
      device_id: validId,
      latitude: lat,
      longitude: lng,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const endpoint = `${this.http.options.ingestUrl.replace(/\/+$/, '')}/ingest`;
    await this.http.request({
      endpoint,
      method: 'POST',
      body: payload,
    });
  }

  /**
   * Creates a spatial geofence polygon in PostGIS via the management REST API.
   * Automatically validates and closes the polygon ring.
   * Equivalent to Go's Client.CreateGeofence.
   *
   * @param name Geofence name
   * @param coordinates Array of [latitude, longitude] pairs (at least 3 coordinates)
   * @param webhookUrl Optional webhook URL triggered upon enter/exit
   */
  async createGeofence(
    name: string,
    coordinates: Array<[number, number] | number[]>,
    webhookUrl?: string
  ): Promise<unknown> {
    if (this.isClosed) {
      throw new ClientClosedError();
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new ValidationError('geoengine: name is required');
    }

    const polygon = validateAndNormalizePolygon(coordinates);

    const payload = {
      name: name.trim(),
      webhook_url: webhookUrl,
      geojson: {
        type: 'Polygon',
        coordinates: [polygon],
      },
    };

    const endpoint = `${this.http.options.managementUrl.replace(/\/+$/, '')}/geofences`;
    return this.http.request({
      endpoint,
      method: 'POST',
      body: payload,
    });
  }

  // --- Spatial Validation Direct Shortcuts ---

  /**
   * Validates if coordinates fall within a geofence by ID via the Spatial service.
   * Shortcut matching Go's Client.ValidateSpatialPoint.
   */
  async validateSpatialPoint(
    geofenceId: string,
    lat: number,
    lng: number
  ): Promise<SpatialValidationResult> {
    if (this.isClosed) {
      throw new ClientClosedError();
    }
    return this.spatial.validatePoint(geofenceId, lat, lng);
  }

  /**
   * Validates if coordinates fall within a geofence via the Spatial service.
   * Shortcut matching Go's Client.ValidateSpatialLocation.
   */
  async validateSpatialLocation(
    req: SpatialValidationRequest
  ): Promise<SpatialValidationResult> {
    if (this.isClosed) {
      throw new ClientClosedError();
    }
    return this.spatial.validateLocation(req);
  }

  /**
   * Validates coordinates against all active geofences via the Spatial service.
   * Shortcut matching Go's Client.ValidateSpatialGeneral.
   */
  async validateSpatialGeneral(
    lat: number,
    lng: number
  ): Promise<SpatialGeneralResult> {
    if (this.isClosed) {
      throw new ClientClosedError();
    }
    return this.spatial.validateGeneral(lat, lng);
  }

  /**
   * Validates coordinates against all active geofences via the Spatial service.
   * Shortcut matching Go's Client.ValidateSpatialGeneralLocation.
   */
  async validateSpatialGeneralLocation(
    req: SpatialGeneralRequest
  ): Promise<SpatialGeneralResult> {
    if (this.isClosed) {
      throw new ClientClosedError();
    }
    return this.spatial.validateGeneralLocation(req);
  }

  /**
   * Instantiates a new AsyncIngester connected to this client.
   * Matches Go NewAsyncIngester.
   *
   * @param bufferSize Queue buffer capacity (default: options.bufferSize ?? 5000)
   * @param batchSize Batch size before flushing (default: options.batchSize ?? 100)
   * @param flushIntervalMs Flush interval in ms (default: options.flushInterval ?? 500)
   */
  createAsyncIngester(
    bufferSize?: number,
    batchSize?: number,
    flushIntervalMs?: number
  ): AsyncIngester {
    return new AsyncIngester(
      this,
      bufferSize ?? this.http.options.bufferSize,
      batchSize ?? this.http.options.batchSize,
      flushIntervalMs ?? this.http.options.flushInterval
    );
  }

  /**
   * Closes the client, marking it inactive. Idempotent.
   * Subsequent requests will throw ClientClosedError.
   * Equivalent to Go's Client.Close.
   */
  close(): void {
    this.isClosed = true;
  }
}

/**
 * Default export matching standard Node.js module import.
 */
export default GeoEngine;
