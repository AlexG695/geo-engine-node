import { generateHMACSignature } from './crypto.js';
import {
  APIError,
  APIServiceError,
  AuthenticationError,
  ForbiddenError,
  GeofenceNotFoundError,
  InvitationPendingError,
  LastAdminError,
  LastSubjectError,
  QuotaExceededError,
  RuleNotFoundError,
  SpatialAPIError,
  SpatialErrorDetail,
  TimeoutError,
  UserAlreadyExistsError,
  UserNotFoundError,
  ValidationError,
} from './errors.js';
import type { GeoEngineOptions } from './models.js';
import { SDK_VERSION } from './version.js';

export const USER_AGENT = `GeoEngineNodeSDK/${SDK_VERSION}`;

export interface RequestOptions {
  method?: string;
  endpoint: string;
  body?: unknown;
  timeout?: number;
  isSpatial?: boolean;
  /**
   * Marks a Users / GeoIdentity call: the `{ success, data }` envelope is unwrapped,
   * errors are parsed into APIServiceError subclasses, and only GET requests are
   * retried automatically (writes such as invitations must not be sent twice).
   */
  isApiService?: boolean;
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

/**
 * Parses an api-service error body (Users and GeoIdentity endpoints) into a typed error.
 * Equivalent to Go's parseAPIServiceError + APIServiceError.sentinel.
 */
export function parseApiServiceError(statusCode: number, bodyText: string): APIError {
  let parsed: {
    error?: { message?: string; status?: string; details?: SpatialErrorDetail[] };
  } | null = null;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Non-JSON response body
  }

  const container = parsed && typeof parsed === 'object' ? parsed.error : undefined;
  const details = Array.isArray(container?.details) ? container.details : [];
  let code = '';
  let message = '';

  if (container && typeof container === 'object') {
    code = container.status ?? '';
    message = container.message ?? '';
    const withReason = details.find(d => d?.reason);
    if (withReason?.reason) {
      code = withReason.reason;
    }
  } else {
    message = bodyText.trim();
  }

  if (!message) {
    message = `HTTP ${statusCode}`;
  }

  switch (code) {
    case 'USER_NOT_FOUND':
    case 'USER_REVOKED':
      return new UserNotFoundError(message, statusCode, code, details);
    case 'RULE_NOT_FOUND':
      return new RuleNotFoundError(message, statusCode, code, details);
    case 'USER_ALREADY_EXISTS':
      return new UserAlreadyExistsError(message, statusCode, code, details);
    case 'INVITATION_PENDING':
      return new InvitationPendingError(message, statusCode, code, details);
    case 'LAST_ADMIN':
      return new LastAdminError(message, statusCode, code, details);
    case 'LAST_SUBJECT':
      return new LastSubjectError(message, statusCode, code, details);
    case 'QUOTA_EXCEEDED':
      return new QuotaExceededError(message, statusCode, details);
    case 'MISSING_API_KEY':
    case 'MISSING_ORGANIZATION':
      return new AuthenticationError(message, statusCode, details);
  }

  switch (statusCode) {
    case 401:
      return new AuthenticationError(message, statusCode, details);
    case 403:
      return new ForbiddenError(message, statusCode, details);
    case 402:
      return new QuotaExceededError(message, statusCode, details);
  }

  return new APIServiceError(statusCode, code, message, details);
}

export interface HttpClientConfig {
  jwtToken?: string;
  environment: string;
  managementUrl: string;
  ingestUrl: string;
  apiServiceUrl: string;
  timeout: number;
  identityTimeoutMs: number;
  maxRetries: number;
  batchSize: number;
  flushInterval: number;
  bufferSize: number;
  fetch: (...args: any[]) => Promise<any>;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Ensures a configured service URL is safe to send credentials to:
 * https, or http only for loopback hosts. Throws before any request is made.
 */
export function assertSecureServiceUrl(name: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError(`GeoEngine: ${name} no es una URL válida.`);
  }
  if (parsed.protocol === 'https:') {
    return;
  }
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return;
  }
  throw new ValidationError(
    `GeoEngine: ${name} debe usar https (http solo se permite para localhost, 127.0.0.1 o ::1).`
  );
}

/**
 * Robust HTTP client handling authentication headers, HMAC generation,
 * timeouts via AbortController, and exponential backoff retries.
 */
export class HttpClient {
  #apiKey: string;
  private readonly config: HttpClientConfig;

  constructor(options: GeoEngineOptions = {}) {
    const defaultManagement = 'https://management.geoengine.dev';
    const defaultIngest = 'https://ingest.geoengine.dev';
    const defaultApiService = 'https://api.geoengine.dev';

    this.#apiKey = options.apiKey ?? '';
    const resolvedUrls = {
      managementUrl: options.baseUrl ?? options.managementUrl ?? defaultManagement,
      ingestUrl: options.baseUrl ?? options.ingestUrl ?? defaultIngest,
      apiServiceUrl: options.baseUrl ?? options.apiServiceUrl ?? defaultApiService,
    };
    const urlLabels: Record<keyof typeof resolvedUrls, string> = {
      managementUrl: options.baseUrl !== undefined ? 'baseUrl' : 'managementUrl',
      ingestUrl: options.baseUrl !== undefined ? 'baseUrl' : 'ingestUrl',
      apiServiceUrl: options.baseUrl !== undefined ? 'baseUrl' : 'apiServiceUrl',
    };
    for (const key of Object.keys(resolvedUrls) as Array<keyof typeof resolvedUrls>) {
      assertSecureServiceUrl(urlLabels[key], resolvedUrls[key]);
    }
    this.config = {
      jwtToken: options.jwtToken,
      environment: options.environment ?? 'live',
      ...resolvedUrls,
      timeout: options.timeout ?? 10000,
      identityTimeoutMs: options.identityTimeoutMs ?? 500,
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

  toJSON(): Record<string, unknown> {
    return {
      apiKey: '[REDACTED]',
      ...(this.config.jwtToken ? { jwtToken: '[REDACTED]' } : {}),
      environment: this.config.environment,
      managementUrl: this.config.managementUrl,
      ingestUrl: this.config.ingestUrl,
      apiServiceUrl: this.config.apiServiceUrl,
      timeout: this.config.timeout,
      identityTimeoutMs: this.config.identityTimeoutMs,
      maxRetries: this.config.maxRetries,
      batchSize: this.config.batchSize,
      flushInterval: this.config.flushInterval,
      bufferSize: this.config.bufferSize,
    };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): Record<string, unknown> {
    return this.toJSON();
  }

  /**
   * Executes an HTTP request with timeout, authentication headers and exponential backoff retry.
   */
  async request<T>(opts: RequestOptions): Promise<T> {
    const method = opts.method ?? 'POST';
    const timeoutMs = opts.timeout ?? this.config.timeout;
    const maxRetries =
      opts.isApiService && method !== 'GET' ? 0 : this.config.maxRetries;

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
        ...(opts.isApiService
          ? { Accept: 'application/json' }
          : { 'Content-Type': 'application/json' }),
        'X-API-Key': this.#apiKey,
        'X-Geo-Environment': this.config.environment,
        'X-Request-Time': now.toString(),
        'X-Signature': generateHMACSignature(this.#apiKey, now),
        'User-Agent': USER_AGENT,
      };

      if (opts.isApiService && opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      if (this.config.jwtToken) {
        headers['Authorization'] = `Bearer ${this.config.jwtToken}`;
      }

      try {
        const response = await this.config.fetch(opts.endpoint, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
          // Never follow redirects: custom headers (X-API-Key, X-Signature) are not
          // stripped by fetch on cross-origin redirects.
          redirect: 'manual',
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
          throw opts.isApiService
            ? parseApiServiceError(response.status, responseText)
            : parseHttpError(response.status, responseText, opts.isSpatial);
        }

        if (!responseText || responseText.trim() === '') {
          return null as T;
        }

        const json = JSON.parse(responseText);

        // api-service responses are wrapped in { success: boolean, data: T }
        if ((opts.isSpatial || opts.isApiService) && typeof json === 'object' && json !== null && 'success' in json) {
          if (!json.success) {
            throw opts.isApiService
              ? parseApiServiceError(response.status, responseText)
              : parseHttpError(response.status, responseText, true);
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
