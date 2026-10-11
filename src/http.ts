import { generateHMACSignature } from './crypto.js';
import {
  APIError,
  AuthenticationError,
  ForbiddenError,
  GeofenceNotFoundError,
  QuotaExceededError,
  SpatialAPIError,
  SpatialErrorDetail,
  TimeoutError,
} from './errors.js';
import type { GeoEngineOptions } from './models.js';

export const USER_AGENT = 'GeoEngineNodeSDK/2.0.0';

export interface RequestOptions {
  method?: string;
  endpoint: string;
  body?: unknown;
  timeout?: number;
  isSpatial?: boolean;
}

/**
 * Parses raw error responses into typed GeoEngine errors matching Go SDK parseSpatialError.
 */
export function parseHttpError(
  statusCode: number,
  bodyText: string,
  isSpatial = false
): APIError {
  let parsedErrorContainer: {
    error?: {
      code?: number;
      message?: string;
      status?: string;
      details?: SpatialErrorDetail[];
    };
    message?: string;
  } | null = null;

  try {
    parsedErrorContainer = JSON.parse(bodyText);
  } catch {
    // Non-JSON response body
  }

  const container = parsedErrorContainer?.error;
  let code = container?.status ?? '';
  let message = container?.message ?? parsedErrorContainer?.message ?? bodyText.trim();
  const details = container?.details ?? [];

  if (container?.details && container.details.length > 0) {
    for (const detail of container.details) {
      if (detail.reason) {
        code = detail.reason;
        break;
      }
    }
  }

  if (!code) {
    switch (statusCode) {
      case 204:
      case 404:
        code = 'NOT_FOUND';
        break;
      case 402:
        code = 'QUOTA_EXCEEDED';
        break;
      case 401:
        code = 'UNAUTHORIZED';
        break;
      case 403:
        code = 'FORBIDDEN';
        break;
      default:
        code = '';
    }
  }

  if (!message) {
    message = `HTTP ${statusCode}`;
  }

  // Map to specific semantic subclasses
  if (statusCode === 204 || statusCode === 404 || code === 'NOT_FOUND') {
    return new GeofenceNotFoundError(message, statusCode, details);
  }
  if (statusCode === 402 || code === 'QUOTA_EXCEEDED') {
    return new QuotaExceededError(message, statusCode, details);
  }
  if (statusCode === 401 || code === 'UNAUTHORIZED' || code === 'MISSING_API_KEY' || code === 'MISSING_ORGANIZATION') {
    return new AuthenticationError(message, statusCode, details);
  }
  if (statusCode === 403 || code === 'FORBIDDEN') {
    return new ForbiddenError(message, statusCode, details);
  }

  if (isSpatial) {
    return new SpatialAPIError(statusCode, code, message, undefined, details);
  }

  return new APIError(statusCode, message);
}

export interface HttpClientConfig {
  apiKey: string;
  jwtToken?: string;
  environment: string;
  managementUrl: string;
  ingestUrl: string;
  apiServiceUrl: string;
  timeout: number;
  maxRetries: number;
  batchSize: number;
  flushInterval: number;
  bufferSize: number;
  fetch: (...args: any[]) => Promise<any>;
}

/**
 * Robust HTTP client handling authentication headers, HMAC generation,
 * timeouts via AbortController, and exponential backoff retries.
 */
export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(options: GeoEngineOptions = {}) {
    const defaultManagement = 'https://management.geoengine.dev';
    const defaultIngest = 'https://ingest.geoengine.dev';
    const defaultApiService = 'https://api.geoengine.dev';

    this.config = {
      apiKey: options.apiKey ?? '',
      jwtToken: options.jwtToken,
      environment: options.environment ?? 'live',
      managementUrl: options.baseUrl ?? options.managementUrl ?? defaultManagement,
      ingestUrl: options.baseUrl ?? options.ingestUrl ?? defaultIngest,
      apiServiceUrl: options.baseUrl ?? options.apiServiceUrl ?? defaultApiService,
      timeout: options.timeout ?? 10000,
      maxRetries: options.maxRetries ?? 2,
      batchSize: options.batchSize ?? 100,
      flushInterval: options.flushInterval ?? 500,
      bufferSize: options.bufferSize ?? 5000,
      fetch: options.fetch ?? (globalThis as typeof globalThis & { fetch: HttpClientConfig['fetch'] }).fetch,
    };
  }

  get options(): Readonly<HttpClientConfig> {
    return this.config;
  }

  /**
   * Executes an HTTP request with timeout, authentication headers and exponential backoff retry.
   */
  async request<T>(opts: RequestOptions): Promise<T> {
    const method = opts.method ?? 'POST';
    const timeoutMs = opts.timeout ?? this.config.timeout;
    const maxRetries = this.config.maxRetries;

    let attempt = 0;
    while (true) {
      attempt++;
      const controller = new (globalThis as typeof globalThis & {
        AbortController: new () => { signal: unknown; abort: () => void };
      }).AbortController();
      const timeoutId = (globalThis as typeof globalThis & {
        setTimeout: (handler: () => void, timeout?: number) => unknown;
      }).setTimeout(() => controller.abort(), timeoutMs);

      const now = Date.now();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        'X-Geo-Environment': this.config.environment,
        'X-Request-Time': now.toString(),
        'X-Signature': generateHMACSignature(this.config.apiKey, now),
        'User-Agent': USER_AGENT,
      };

      if (this.config.jwtToken) {
        headers['Authorization'] = `Bearer ${this.config.jwtToken}`;
      }

      try {
        const response = await this.config.fetch(opts.endpoint, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });

        (globalThis as typeof globalThis & {
          clearTimeout: (timeoutId: unknown) => void;
        }).clearTimeout(timeoutId);

        // Handle 204 No Content
        if (response.status === 204) {
          if (opts.isSpatial) {
            throw new GeofenceNotFoundError('geofence not found', 204);
          }
          return null as T;
        }

        // Retry on 429 (rate limit) or 5xx server errors
        if ((response.status === 429 || response.status >= 500) && attempt <= maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 2000);
          await new Promise<void>(resolve =>
            (globalThis as typeof globalThis & {
              setTimeout: (handler: () => void, timeout?: number) => unknown;
            }).setTimeout(() => resolve(), delay)
          );
          continue;
        }

        const responseText = await response.text();

        if (!response.ok) {
          throw parseHttpError(response.status, responseText, opts.isSpatial);
        }

        if (!responseText || responseText.trim() === '') {
          return null as T;
        }

        const json = JSON.parse(responseText);

        // In Spatial API, responses are wrapped in { success: boolean, data: T }
        if (opts.isSpatial && typeof json === 'object' && json !== null && 'success' in json) {
          if (!json.success) {
            throw parseHttpError(response.status, responseText, true);
          }
          return json.data as T;
        }

        return json as T;
      } catch (err: unknown) {
        (globalThis as typeof globalThis & {
          clearTimeout: (timeoutId: unknown) => void;
        }).clearTimeout(timeoutId);

        if (err instanceof Error && err.name === 'AbortError') {
          throw new TimeoutError(timeoutMs);
        }

        // If it's already an API error (from response handling), rethrow without retrying
        if (err instanceof APIError) {
          throw err;
        }

        // Network error (fetch failure): retry if attempts remain
        if (attempt <= maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 2000);
          await new Promise<void>(resolve =>
            (globalThis as typeof globalThis & {
              setTimeout: (handler: () => void, timeout?: number) => unknown;
            }).setTimeout(() => resolve(), delay)
          );
          continue;
        }

        throw err;
      }
    }
  }
}
