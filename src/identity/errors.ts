import { GeoEngineError } from '../errors.js';
import type { IdentityIntegrationReason, IdentityTransientReason } from './types.js';

const TRANSIENT_BRAND = Symbol.for('geo-engine-node.IdentityTransientError');
const INTEGRATION_BRAND = Symbol.for('geo-engine-node.IdentityIntegrationError');

export interface IdentityErrorFields<R extends string> {
  message: string;
  status?: number;
  type?: string;
  title?: string;
  detail?: string;
  requestId?: string;
  reason: R;
  apiKeyToRedact?: string;
}

function redactSecret(value: string | undefined, secret?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let sanitized = value;
  if (secret) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
    const trimmed = secret.trim();
    if (trimmed && trimmed !== secret) {
      sanitized = sanitized.split(trimmed).join('[REDACTED]');
    }
  }
  return sanitized;
}

function buildSafeErrorPayload(
  name: string,
  message: string,
  fields: {
    code?: string;
    status?: number;
    type?: string;
    title?: string;
    detail?: string;
    requestId?: string;
    reason: string;
  }
): Record<string, unknown> {
  return {
    name,
    code: (fields as { code?: string }).code,
    message,
    status: fields.status,
    type: fields.type,
    title: fields.title,
    detail: fields.detail,
    requestId: fields.requestId,
    reason: fields.reason,
  };
}

/**
 * Transient evaluation error (network, timeout, 5xx, 429, or non-JSON 5xx).
 * `identityGuard` applies the configured `failOpen` policy for this error class.
 */
export class IdentityTransientError extends GeoEngineError {
  readonly status?: number;
  readonly type?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly reason: IdentityTransientReason;
  /** Stable machine-readable code; the contract between ESM and CJS builds. */
  readonly code = 'IDENTITY_TRANSIENT' as const;

  readonly [TRANSIENT_BRAND] = true;

  static [Symbol.hasInstance](instance: unknown): boolean {
    return (
      typeof instance === 'object' &&
      instance !== null &&
      TRANSIENT_BRAND in instance
    );
  }

  constructor(fields: IdentityErrorFields<IdentityTransientReason>) {
    const safeMessage = redactSecret(fields.message, fields.apiKeyToRedact) ?? 'GeoIdentity transient error';
    super(safeMessage);
    this.name = 'IdentityTransientError';
    this.status = fields.status;
    this.type = redactSecret(fields.type, fields.apiKeyToRedact);
    this.title = redactSecret(fields.title, fields.apiKeyToRedact);
    this.detail = redactSecret(fields.detail, fields.apiKeyToRedact);
    this.requestId = redactSecret(fields.requestId, fields.apiKeyToRedact);
    this.reason = fields.reason;
  }

  toJSON(): Record<string, unknown> {
    return buildSafeErrorPayload(this.name, this.message, this);
  }

  [Symbol.for('nodejs.util.inspect.custom')](): Record<string, unknown> {
    return this.toJSON();
  }
}

/**
 * Integration or client configuration error (400, 401, 403, 404, 422, edge 403,
 * unexpected 200 payload, or invalid input). `identityGuard` NEVER applies `failOpen`.
 */
export class IdentityIntegrationError extends GeoEngineError {
  readonly status?: number;
  readonly type?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly reason: IdentityIntegrationReason;
  /** Stable machine-readable code; the contract between ESM and CJS builds. */
  readonly code = 'IDENTITY_INTEGRATION' as const;

  readonly [INTEGRATION_BRAND] = true;

  static [Symbol.hasInstance](instance: unknown): boolean {
    return (
      typeof instance === 'object' &&
      instance !== null &&
      INTEGRATION_BRAND in instance
    );
  }

  constructor(fields: IdentityErrorFields<IdentityIntegrationReason>) {
    const safeMessage = redactSecret(fields.message, fields.apiKeyToRedact) ?? 'GeoIdentity integration error';
    super(safeMessage);
    this.name = 'IdentityIntegrationError';
    this.status = fields.status;
    this.type = redactSecret(fields.type, fields.apiKeyToRedact);
    this.title = redactSecret(fields.title, fields.apiKeyToRedact);
    this.detail = redactSecret(fields.detail, fields.apiKeyToRedact);
    this.requestId = redactSecret(fields.requestId, fields.apiKeyToRedact);
    this.reason = fields.reason;
  }

  toJSON(): Record<string, unknown> {
    return buildSafeErrorPayload(this.name, this.message, this);
  }

  [Symbol.for('nodejs.util.inspect.custom')](): Record<string, unknown> {
    return this.toJSON();
  }
}

/**
 * Type guard that identifies transient GeoIdentity errors across ESM/CJS entrypoints.
 */
export function isTransient(err: unknown): err is IdentityTransientError {
  return (
    typeof err === 'object' &&
    err !== null &&
    TRANSIENT_BRAND in err
  );
}
