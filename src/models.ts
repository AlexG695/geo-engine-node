/**
 * Configuration options for the GeoEngine Client.
 * Matches and extends Go SDK Options.
 */
export interface GeoEngineOptions {
  /**
   * Secret API key. Can also be passed directly as first parameter to constructor.
   */
  apiKey?: string;

  /**
   * Bearer JWT token for authenticated operations.
   */
  jwtToken?: string;

  /**
   * Target environment ('live' or 'test'). Defaults to 'live'.
   */
  environment?: 'live' | 'test' | string;

  /**
   * Management service URL for geofences and administrative operations.
   * Default: 'https://management.geoengine.dev'
   */
  managementUrl?: string;

  /**
   * Ingestion service URL for telemetry coordinates.
   * Default: 'https://ingest.geoengine.dev'
   */
  ingestUrl?: string;

  /**
   * Spatial API service URL for spatial validation queries.
   * Default: 'https://api.geoengine.dev'
   */
  apiServiceUrl?: string;

  /**
   * Convenience option to set ingestUrl, managementUrl, and apiServiceUrl to the same base URL (useful for testing/mocking).
   */
  baseUrl?: string;

  /**
   * HTTP request timeout in milliseconds. Default: 10000ms (10 seconds).
   */
  timeout?: number;

  /**
   * Maximum number of automatic retries on network failures or 429/5xx status codes.
   * Default: 2.
   */
  maxRetries?: number;

  /**
   * Maximum batch size before flushing in AsyncIngester. Default: 100.
   */
  batchSize?: number;

  /**
   * Flush interval in milliseconds for AsyncIngester. Default: 500ms.
   */
  flushInterval?: number;

  /**
   * Buffer capacity for AsyncIngester queue. Default: 5000.
   */
  bufferSize?: number;

  /**
   * Custom fetch implementation (useful for testing or custom polyfills).
   */
  fetch?: typeof globalThis extends { fetch: infer Fetch } ? Fetch : (...args: unknown[]) => Promise<unknown>;
}

/**
 * Single telemetry ping matching PostGIS location_history and Go LocationPing.
 */
export interface LocationPing {
  deviceId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  isMocked?: boolean;
}

/**
 * Ingestion response status matching Go IngestResponse.
 */
export interface IngestResponse {
  success: boolean;
  processedCount: number;
  errorMessage?: string;
}

/**
 * Parameters for creating a geofence.
 */
export interface GeofenceRequest {
  name: string;
  description?: string;
  color?: string;
  webhookUrl?: string;
  geojson: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

/**
 * Parameters for validating a point against a specific geofence.
 */
export interface SpatialValidationRequest {
  geofenceId: string;
  latitude: number;
  longitude: number;
}

export interface SpatialValidationResultData {
  inside: boolean;
  geofence_id?: string;
  geofenceId?: string;
  geofence_name?: string;
  geofenceName?: string;
  latitude: number;
  longitude: number;
}

/**
 * Represents the validation result for a single geofence.
 * Enriched class matching Go's SpatialValidationResult with helper methods.
 */
export class SpatialValidationResult {
  readonly inside: boolean;
  readonly geofenceId: string;
  readonly geofenceName?: string;
  readonly latitude: number;
  readonly longitude: number;

  constructor(data: SpatialValidationResultData) {
    this.inside = Boolean(data.inside);
    this.geofenceId = data.geofence_id ?? data.geofenceId ?? '';
    this.geofenceName = data.geofence_name ?? data.geofenceName;
    this.latitude = data.latitude;
    this.longitude = data.longitude;
  }

  /**
   * Returns true if the coordinate is inside the geofence.
   */
  isInside(): boolean {
    return this.inside;
  }

  /**
   * Returns true if the coordinate is outside the geofence.
   */
  isOutside(): boolean {
    return !this.inside;
  }

  /**
   * Returns latitude and longitude as a [latitude, longitude] tuple.
   */
  coordinates(): [number, number] {
    return [this.latitude, this.longitude];
  }

  /**
   * Formats the result into a clean, human-readable log string matching Go's String().
   */
  toString(): string {
    const status = this.inside ? 'INSIDE' : 'OUTSIDE';
    const name = this.geofenceName || 'unnamed';
    return `[${status}] geofence=${this.geofenceId} (${name}) at (${this.latitude.toFixed(6)}, ${this.longitude.toFixed(6)})`;
  }
}

/**
 * Parameters for validating a point against all active geofences in the organization.
 */
export interface SpatialGeneralRequest {
  latitude: number;
  longitude: number;
}

/**
 * Represents a matched geofence in general validation.
 */
export interface GeofenceMatch {
  id: string;
  name: string;
}

export interface SpatialGeneralResultData {
  inside: boolean;
  total_matches?: number;
  totalMatches?: number;
  matched_geofences?: GeofenceMatch[];
  matchedGeofences?: GeofenceMatch[];
  latitude: number;
  longitude: number;
}

/**
 * Represents the result of validating a point against all active geofences.
 * Enriched class matching Go's SpatialGeneralResult with helper methods.
 */
export class SpatialGeneralResult {
  readonly inside: boolean;
  readonly totalMatches: number;
  readonly matchedGeofences: GeofenceMatch[];
  readonly latitude: number;
  readonly longitude: number;

  constructor(data: SpatialGeneralResultData) {
    this.inside = Boolean(data.inside);
    this.totalMatches = data.total_matches ?? data.totalMatches ?? (data.matched_geofences?.length ?? data.matchedGeofences?.length ?? 0);
    this.matchedGeofences = data.matched_geofences ?? data.matchedGeofences ?? [];
    this.latitude = data.latitude;
    this.longitude = data.longitude;
  }

  /**
   * Returns true if the coordinate falls inside at least one geofence.
   */
  isInside(): boolean {
    return this.inside;
  }

  /**
   * Returns true if one or more geofences matched the point.
   */
  hasMatches(): boolean {
    return this.totalMatches > 0;
  }

  /**
   * Returns the first matched geofence, or null if no matches found.
   */
  firstMatch(): GeofenceMatch | null {
    return this.matchedGeofences[0] ?? null;
  }

  /**
   * Returns all matched geofence IDs as a string array.
   */
  geofenceIds(): string[] {
    return this.matchedGeofences.map(m => m.id);
  }

  /**
   * Returns all matched geofence names as a string array.
   */
  geofenceNames(): string[] {
    return this.matchedGeofences.map(m => m.name);
  }

  /**
   * Checks whether a specific geofence ID or name is among the matches.
   */
  containsGeofence(idOrName: string): boolean {
    return this.findMatch(idOrName) !== null;
  }

  /**
   * Searches for a matched geofence by ID or name and returns it if found, or null.
   */
  findMatch(idOrName: string): GeofenceMatch | null {
    for (const match of this.matchedGeofences) {
      if (match.id === idOrName || match.name === idOrName) {
        return match;
      }
    }
    return null;
  }

  /**
   * Returns latitude and longitude as a [latitude, longitude] tuple.
   */
  coordinates(): [number, number] {
    return [this.latitude, this.longitude];
  }

  /**
   * Formats the result into a clean, human-readable log string matching Go's String().
   */
  toString(): string {
    const status = this.inside ? 'INSIDE' : 'OUTSIDE';
    const names = this.geofenceNames().join(', ');
    return `[${status}] matches=${this.totalMatches} (${names}) at (${this.latitude.toFixed(6)}, ${this.longitude.toFixed(6)})`;
  }
}
