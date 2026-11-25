import { randomUUID } from 'node:crypto';
import { ClientClosedError } from '../errors.js';
import { USER_AGENT } from '../http.js';
import { IdentityIntegrationError, IdentityTransientError } from './errors.js';
import { assertServerEnvironment } from './runtime.js';
import type {
  Challenge,
  EvaluateMeta,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResponse,
  IdentityIntegrationReason,
  RuleRef,
  ShadowMatch,
} from './types.js';

const DEFAULT_IDENTITY_TIMEOUT_MS = 500;
const MIN_RETRY_BUDGET_MS = 10;
const RETRY_SAFETY_MARGIN_MS = 5;

export interface IdentityServiceConfig {
  getBaseUrl: () => string;
  getApiKey: () => string;
  getTimeoutMs: () => number;
  getFetch: () => (...args: any[]) => Promise<any>;
  isClosed: () => boolean;
}

interface ParsedProblem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  request_id?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseProblemJson(contentType: string, rawBody: string): ParsedProblem | null {
  const mediaType = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (mediaType !== 'application/problem+json') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  const result: ParsedProblem = {};
  if (typeof parsed.type === 'string') {
    result.type = parsed.type;
  }
  if (typeof parsed.title === 'string') {
    result.title = parsed.title;
  }
  if (typeof parsed.status === 'number' && Number.isInteger(parsed.status)) {
    result.status = parsed.status;
  }
  if (typeof parsed.detail === 'string') {
    result.detail = parsed.detail;
  }
  if (typeof parsed.request_id === 'string') {
    result.request_id = parsed.request_id;
  }
  return result;
}

function parseRuleRef(value: unknown): RuleRef | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.priority !== 'number' ||
    !Number.isFinite(value.priority)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    priority: value.priority,
  };
}

function parseShadowMatches(value: unknown): ShadowMatch[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const matches: ShadowMatch[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      return null;
    }
    const rule = parseRuleRef(entry.rule);
    if (!rule || typeof entry.would_decide !== 'string') {
      return null;
    }
    const shadowMatch: ShadowMatch = {
      rule,
      would_decide: entry.would_decide,
    };
    if (entry.signals !== undefined) {
      if (!Array.isArray(entry.signals) || !entry.signals.every((s) => typeof s === 'string')) {
        return null;
      }
      shadowMatch.signals = [...entry.signals];
    }
    matches.push(shadowMatch);
  }
  return matches;
}

function parseEvaluateMeta(value: unknown): EvaluateMeta | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (
    typeof value.config_version !== 'number' ||
    !Number.isFinite(value.config_version) ||
    typeof value.stale !== 'boolean' ||
    typeof value.config_age_s !== 'number' ||
    !Number.isFinite(value.config_age_s) ||
    typeof value.source !== 'string' ||
    typeof value.evaluated_at !== 'string'
  ) {
    return null;
  }

  const meta: EvaluateMeta = {
    config_version: value.config_version,
    stale: value.stale,
    config_age_s: value.config_age_s,
    source: value.source,
    evaluated_at: value.evaluated_at,
  };

  if (typeof value.request_id === 'string') {
    meta.request_id = value.request_id;
  }
  if (typeof value.reputation === 'string') {
    meta.reputation = value.reputation;
  }

  return meta;
}

function parseEvaluateResponse(rawBody: string): EvaluateResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  if (typeof parsed.decision !== 'string' || parsed.decision.length === 0) {
    return null;
  }

  let matchedRule: RuleRef | null = null;
  if (parsed.matched_rule !== null) {
    matchedRule = parseRuleRef(parsed.matched_rule);
    if (!matchedRule) {
      return null;
    }
  }

  if (typeof parsed.default_applied !== 'boolean' || typeof parsed.reason !== 'string') {
    return null;
  }

  if (!Array.isArray(parsed.signals) || !parsed.signals.every((s) => typeof s === 'string')) {
    return null;
  }

  const shadowMatches = parseShadowMatches(parsed.shadow_matches);
  if (!shadowMatches) {
    return null;
  }

  const meta = parseEvaluateMeta(parsed.meta);
  if (!meta) {
    return null;
  }

  let challenge: Challenge | undefined;
  if (parsed.challenge !== undefined && parsed.challenge !== null) {
    if (!isPlainObject(parsed.challenge)) {
      return null;
    }
    challenge = {};
    if (typeof parsed.challenge.hint === 'string') {
      challenge.hint = parsed.challenge.hint;
    }
  }

  const result: EvaluateResponse = {
    decision: parsed.decision,
    matched_rule: matchedRule,
    default_applied: parsed.default_applied,
    reason: parsed.reason,
    signals: [...parsed.signals],
    shadow_matches: shadowMatches,
    meta,
  };

  if (challenge !== undefined) {
    result.challenge = challenge;
  }

  return result;
}

function buildRequestPayload(request: EvaluateRequest): Record<string, unknown> {
  const subjectPayload: Record<string, unknown> = {};
  if (request.subject.user_id !== undefined) {
    subjectPayload.user_id = request.subject.user_id;
  }
  if (request.subject.device_id !== undefined) {
    subjectPayload.device_id = request.subject.device_id;
  }
  if (request.subject.roles !== undefined) {
    subjectPayload.roles = request.subject.roles;
  }

  const payload: Record<string, unknown> = {
    scope: request.scope,
    subject: subjectPayload,
  };

  if (request.context !== undefined && request.context !== null) {
    const contextPayload: Record<string, unknown> = {};
    if (request.context.ip !== undefined) {
      contextPayload.ip = request.context.ip;
    }
    if (request.context.location !== undefined && request.context.location !== null) {
      const loc = request.context.location;
      const locationPayload: Record<string, unknown> = {
        lat: loc.lat,
        lng: loc.lng,
      };
      if (loc.accuracy_m !== undefined) {
        locationPayload.accuracy_m = loc.accuracy_m;
      }
      if (loc.source !== undefined) {
        locationPayload.source = loc.source;
      }
      if (loc.captured_at !== undefined) {
        locationPayload.captured_at = loc.captured_at;
      }
      contextPayload.location = locationPayload;
    }
    payload.context = contextPayload;
  }

  return payload;
}

function mapIntegrationReason(status: number, problemType?: string): IdentityIntegrationReason {
  if (problemType) {
    const prefix = 'urn:geoengine:problem:';
    const slug = problemType.startsWith(prefix) ? problemType.slice(prefix.length) : problemType;
    switch (slug) {
      case 'unauthorized':
        return 'unauthorized';
      case 'malformed-request':
        return 'malformed_request';
      case 'invalid-request':
        return 'invalid_request';
      case 'scope-not-found':
        return 'scope_not_found';
      default:
        break;
    }
  }

  switch (status) {
    case 400:
      return 'malformed_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 422:
      return 'invalid_request';
    default:
      return status >= 400 && status < 500 ? 'client_error' : 'unexpected_response';
  }
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (trimmed === '') {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  const targetTime = Date.parse(trimmed);
  if (Number.isNaN(targetTime)) {
    return null;
  }

  return Math.max(0, targetTime - Date.now());
}

function computeJitterDelayMs(remainingMs: number): number | null {
  if (remainingMs <= MIN_RETRY_BUDGET_MS) {
    return null;
  }
  const rawJitter = 10 + Math.random() * 40;
  const maxAllowed = Math.max(0, Math.floor(remainingMs / 3));
  const delay = Math.min(rawJitter, maxAllowed);
  return remainingMs - delay >= MIN_RETRY_BUDGET_MS ? Math.floor(delay) : null;
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  if (ms <= 0) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readTextWithAbort(
  response: { text: () => Promise<string> },
  signal: AbortSignal
): Promise<string> {
  if (signal.aborted) {
    const abortErr = new Error('The operation was aborted.');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };

    signal.addEventListener('abort', onAbort, { once: true });

    Promise.resolve(response.text()).then(
      (text) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(text);
      },
      (err: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Evaluates contextual access policies via `POST /v1/evaluate` (server-only).
 */
export class IdentityService {
  #getBaseUrl: () => string;
  #getApiKey: () => string;
  #getTimeoutMs: () => number;
  #getFetch: () => (...args: any[]) => Promise<any>;
  #isClosed: () => boolean;

  constructor(config: IdentityServiceConfig) {
    this.#getBaseUrl = config.getBaseUrl;
    this.#getApiKey = config.getApiKey;
    this.#getTimeoutMs = config.getTimeoutMs;
    this.#getFetch = config.getFetch;
    this.#isClosed = config.isClosed;
  }

  toJSON(): Record<string, unknown> {
    return {
      service: 'IdentityService',
      apiKey: '[REDACTED]',
    };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): Record<string, unknown> {
    return this.toJSON();
  }

  /**
   * Calls `POST /v1/evaluate` with Bearer authentication, X-Request-Id tracking,
   * a total deadline (default 500ms), and at most one retry for transient failures.
   * Never applies `failOpen` directly; throws typed transient or integration errors.
   */
  async evaluate(request: EvaluateRequest, options?: EvaluateOptions): Promise<EvaluateResponse> {
    assertServerEnvironment();

    if (this.#isClosed()) {
      throw new ClientClosedError();
    }

    const apiKey = this.#getApiKey();

    if (!isPlainObject(request) || !isNonEmptyString(request.scope)) {
      throw new IdentityIntegrationError({
        message: 'GeoIdentity: scope es requerido y debe ser una cadena no vacía',
        reason: 'invalid_request',
        apiKeyToRedact: apiKey,
      });
    }

    if (
      !isPlainObject(request.subject) ||
      (!isNonEmptyString(request.subject.user_id) && !isNonEmptyString(request.subject.device_id))
    ) {
      throw new IdentityIntegrationError({
        message: 'GeoIdentity: subject requiere al menos user_id o device_id',
        reason: 'invalid_request',
        apiKeyToRedact: apiKey,
      });
    }

    const timeoutMs = options?.timeoutMs ?? this.#getTimeoutMs() ?? DEFAULT_IDENTITY_TIMEOUT_MS;
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new IdentityIntegrationError({
        message: 'GeoIdentity: timeoutMs debe ser un número finito mayor a 0',
        reason: 'configuration_error',
        apiKeyToRedact: apiKey,
      });
    }

    if (options?.requestId !== undefined && typeof options.requestId !== 'string') {
      throw new IdentityIntegrationError({
        message: 'GeoIdentity: requestId debe ser una cadena de texto',
        reason: 'invalid_request',
        apiKeyToRedact: apiKey,
      });
    }

    const requestId = options?.requestId ?? randomUUID();
    const endpoint = `${this.#getBaseUrl().replace(/\/+$/, '')}/v1/evaluate`;
    const bodyJson = JSON.stringify(buildRequestPayload(request));
    const fetchFn = this.#getFetch();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/problem+json',
      'X-Request-Id': requestId,
      'User-Agent': USER_AGENT,
    };

    const deadline = Date.now() + timeoutMs;

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (options?.signal?.aborted) {
        throw new IdentityTransientError({
          message: 'GeoIdentity: evaluación cancelada por AbortSignal',
          requestId,
          reason: 'timeout',
          apiKeyToRedact: apiKey,
        });
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new IdentityTransientError({
          message: `GeoIdentity: tiempo de espera agotado (${timeoutMs}ms)`,
          requestId,
          reason: 'timeout',
          apiKeyToRedact: apiKey,
        });
      }

      const controller = new AbortController();
      let onExternalAbort: (() => void) | undefined;
      if (options?.signal) {
        onExternalAbort = () => controller.abort();
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }

      const timeoutId = setTimeout(() => controller.abort(), remainingMs);

      try {
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal: controller.signal,
          redirect: 'manual',
        });

        const rawBody = await readTextWithAbort(response, controller.signal);

        const contentType = response.headers?.get('content-type') ?? '';
        const echoedRequestId = response.headers?.get('x-request-id') || undefined;
        const problem = parseProblemJson(contentType, rawBody);
        const effectiveRequestId = problem?.request_id || echoedRequestId || requestId;

        if (response.status === 200) {
          const parsed = parseEvaluateResponse(rawBody);
          if (!parsed) {
            throw new IdentityIntegrationError({
              message: 'GeoIdentity: forma de respuesta inesperada en HTTP 200',
              status: 200,
              requestId: echoedRequestId ?? requestId,
              reason: 'unexpected_response',
              apiKeyToRedact: apiKey,
            });
          }
          return parsed;
        }

        if (response.status === 429) {
          const retryAfterHeader = response.headers?.get('retry-after') ?? null;
          const rateLimitErr = new IdentityTransientError({
            message:
              problem?.detail ||
              problem?.title ||
              'GeoIdentity: límite de peticiones excedido (HTTP 429)',
            status: 429,
            type: problem?.type,
            title: problem?.title,
            detail: problem?.detail,
            requestId: effectiveRequestId,
            reason: 'rate_limited',
            apiKeyToRedact: apiKey,
          });

          if (attempt >= 2) {
            throw rateLimitErr;
          }

          const nowRemaining = deadline - Date.now();
          let waitMs: number | null;
          if (retryAfterHeader !== null && retryAfterHeader.trim() !== '') {
            const parsedRetryAfter = parseRetryAfterMs(retryAfterHeader);
            if (
              parsedRetryAfter === null ||
              parsedRetryAfter + RETRY_SAFETY_MARGIN_MS >= nowRemaining
            ) {
              throw rateLimitErr;
            }
            waitMs = parsedRetryAfter;
          } else {
            waitMs = computeJitterDelayMs(nowRemaining);
            if (waitMs === null) {
              throw rateLimitErr;
            }
          }

          const slept = await sleepAbortable(waitMs, options?.signal);
          if (!slept) {
            throw new IdentityTransientError({
              message: 'GeoIdentity: evaluación cancelada durante espera de reintento',
              requestId: effectiveRequestId,
              reason: 'timeout',
              apiKeyToRedact: apiKey,
            });
          }
          continue;
        }

        if (response.status >= 500) {
          const serverErr = new IdentityTransientError({
            message:
              problem?.detail ||
              problem?.title ||
              `GeoIdentity: error transitorio del servidor (HTTP ${response.status})`,
            status: response.status,
            type: problem?.type,
            title: problem?.title,
            detail: problem?.detail,
            requestId: effectiveRequestId,
            reason: 'server_error',
            apiKeyToRedact: apiKey,
          });

          if (attempt >= 2) {
            throw serverErr;
          }

          const waitMs = computeJitterDelayMs(deadline - Date.now());
          if (waitMs === null) {
            throw serverErr;
          }

          const slept = await sleepAbortable(waitMs, options?.signal);
          if (!slept) {
            throw new IdentityTransientError({
              message: 'GeoIdentity: evaluación cancelada durante espera de reintento',
              requestId: effectiveRequestId,
              reason: 'timeout',
              apiKeyToRedact: apiKey,
            });
          }
          continue;
        }

        if (response.status === 403 && !problem) {
          throw new IdentityIntegrationError({
            message: 'GeoIdentity: bloqueado en el borde (HTTP 403)',
            status: 403,
            requestId: echoedRequestId ?? requestId,
            reason: 'edge_forbidden',
            apiKeyToRedact: apiKey,
          });
        }

        throw new IdentityIntegrationError({
          message:
            problem?.detail ||
            problem?.title ||
            `GeoIdentity: error de integración (HTTP ${response.status})`,
          status: response.status,
          type: problem?.type,
          title: problem?.title,
          detail: problem?.detail,
          requestId: effectiveRequestId,
          reason: mapIntegrationReason(response.status, problem?.type),
          apiKeyToRedact: apiKey,
        });
      } catch (err: unknown) {
        if (err instanceof IdentityIntegrationError || err instanceof IdentityTransientError) {
          throw err;
        }

        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw new IdentityTransientError({
            message: `GeoIdentity: tiempo de espera agotado (${timeoutMs}ms)`,
            requestId,
            reason: 'timeout',
            apiKeyToRedact: apiKey,
          });
        }

        const networkErr = new IdentityTransientError({
          message: 'GeoIdentity: error de red al evaluar la identidad',
          requestId,
          reason: 'network',
          apiKeyToRedact: apiKey,
        });

        if (attempt >= 2) {
          throw networkErr;
        }

        const waitMs = computeJitterDelayMs(deadline - Date.now());
        if (waitMs === null) {
          throw networkErr;
        }

        const slept = await sleepAbortable(waitMs, options?.signal);
        if (!slept) {
          throw new IdentityTransientError({
            message: 'GeoIdentity: evaluación cancelada durante espera de reintento',
            requestId,
            reason: 'timeout',
            apiKeyToRedact: apiKey,
          });
        }
      } finally {
        clearTimeout(timeoutId);
        if (options?.signal && onExternalAbort) {
          options.signal.removeEventListener('abort', onExternalAbort);
        }
      }
    }

    throw new IdentityTransientError({
      message: `GeoIdentity: tiempo de espera agotado (${timeoutMs}ms)`,
      requestId,
      reason: 'timeout',
      apiKeyToRedact: apiKey,
    });
  }
}
