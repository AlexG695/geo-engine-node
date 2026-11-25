/**
 * Source used to capture the device location signal.
 */
export type LocationSource = 'device' | 'ip' | 'wifi' | 'cell' | 'manual' | (string & {});

/**
 * Geographic location signal sent in the evaluation context.
 */
export interface IdentityLocation {
  lat: number;
  lng: number;
  accuracy_m?: number;
  source?: LocationSource;
  captured_at?: string;
}

/**
 * Request context signals evaluated against the scope rules.
 */
export interface IdentityContext {
  ip?: string;
  location?: IdentityLocation;
}

/**
 * Subject attempting access. All identifiers are opaque client-defined strings.
 * At least one of `user_id` or `device_id` is required.
 */
export type IdentitySubject =
  | {
      user_id: string;
      device_id?: string;
      roles?: string[];
    }
  | {
      user_id?: string;
      device_id: string;
      roles?: string[];
    };

/**
 * Request body for POST /v1/evaluate.
 */
export interface EvaluateRequest {
  scope: string;
  subject: IdentitySubject;
  context?: IdentityContext;
}

/**
 * Per-call options for `client.identity.evaluate`.
 */
export interface EvaluateOptions {
  /** Total deadline in milliseconds for this evaluation, including any retry. Default: 500ms. */
  timeoutMs?: number;
  /** Optional correlation ID sent as X-Request-Id (max 128 chars, no control chars). */
  requestId?: string;
  /** Optional external AbortSignal to cancel the evaluation. */
  signal?: AbortSignal;
}

export type KnownDecision = 'ALLOW' | 'BLOCK' | 'CHALLENGE';
export type Decision = KnownDecision | (string & {});

export type EvaluateReason = 'RULE_MATCH' | 'DEFAULT_ACTION' | (string & {});

export type KnownSignal =
  | 'outside_geo_limit'
  | 'location_missing'
  | 'ip_blocklist'
  | 'ip_not_allowlist'
  | 'datacenter_ip'
  | 'tor_exit';

/**
 * Open set of signals returned by /v1/evaluate.
 */
export type EvaluateSignal = KnownSignal | (string & {});

export interface RuleRef {
  id: string;
  name: string;
  priority: number;
}

export interface ShadowMatch {
  rule: RuleRef;
  would_decide: Decision;
  signals?: EvaluateSignal[];
}

export interface Challenge {
  hint?: 'step_up' | (string & {});
}

export type MetaSource =
  | 'postgres'
  | 'redis'
  | 'memory'
  | 'snapshot'
  | 'fallback'
  | 'sdk_fallback'
  | (string & {});

export type ReputationStatus = 'not_needed' | 'ok' | 'unavailable' | (string & {});

export interface EvaluateMeta {
  config_version: number;
  stale: boolean;
  config_age_s: number;
  source: MetaSource;
  evaluated_at: string;
  request_id?: string;
  reputation?: ReputationStatus;
}

/**
 * Response from POST /v1/evaluate.
 */
export interface EvaluateResponse {
  decision: Decision;
  matched_rule: RuleRef | null;
  default_applied: boolean;
  reason: EvaluateReason;
  signals: EvaluateSignal[];
  shadow_matches: ShadowMatch[];
  challenge?: Challenge;
  meta: EvaluateMeta;
}

export type IdentityTransientReason = 'timeout' | 'network' | 'server_error' | 'rate_limited';

export type FallbackReason = IdentityTransientReason | 'unknown_decision';

export type IdentityIntegrationReason =
  | 'invalid_request'
  | 'malformed_request'
  | 'unauthorized'
  | 'edge_forbidden'
  | 'forbidden'
  | 'not_found'
  | 'scope_not_found'
  | 'client_error'
  | 'unexpected_response'
  | 'configuration_error';

/**
 * Synthetic decision produced locally by `identityGuard` when a transient failure
 * or unknown decision triggers the `failOpen` fallback policy.
 */
export interface FallbackDecision {
  decision: 'ALLOW' | 'BLOCK';
  matched_rule: null;
  default_applied: false;
  reason: 'SDK_FALLBACK';
  signals: EvaluateSignal[];
  shadow_matches: ShadowMatch[];
  fallback: true;
  fallback_reason: FallbackReason;
  meta: EvaluateMeta & { source: 'sdk_fallback' };
}

export type IdentityDecision = EvaluateResponse | FallbackDecision;

export interface GuardRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  [key: string]: unknown;
}

export interface GuardResponse {
  headersSent?: boolean;
  writableEnded?: boolean;
  statusCode: number;
  status?: (code: number) => {
    json?: (body: unknown) => unknown;
    end?: (chunk?: string) => unknown;
  };
  json?: (body: unknown) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  end?: (chunk?: string) => unknown;
  [key: string]: unknown;
}

export type NextFunction = (err?: unknown) => void;

export type IdentityGuardClient =
  | {
      identity: {
        evaluate(request: EvaluateRequest, options?: EvaluateOptions): Promise<EvaluateResponse>;
      };
    }
  | {
      evaluate(request: EvaluateRequest, options?: EvaluateOptions): Promise<EvaluateResponse>;
    };

/**
 * Configuration options for `identityGuard`.
 * `failOpen` is mandatory and has no default value.
 */
export interface IdentityGuardOptions<
  Req extends GuardRequest = GuardRequest,
  Res extends GuardResponse = GuardResponse,
> {
  client: IdentityGuardClient;
  scope: string;
  getSubject: (req: Req) => IdentitySubject | Promise<IdentitySubject>;
  /**
   * Provides request context (`ip`, `location`). If the scope has geographic rules and
   * `location` is omitted, the engine returns HTTP 200 with signal `location_missing`
   * (which may result in BLOCK depending on the rule).
   */
  getContext?: (req: Req) => IdentityContext | undefined | Promise<IdentityContext | undefined>;
  /**
   * Mandatory local fallback policy on transient errors or unknown decisions.
   * `true` allows access on transient failure; `false` blocks (HTTP 403).
   * Integration errors NEVER apply `failOpen`.
   */
  failOpen: boolean;
  timeoutMs?: number;
  onChallenge?: (decision: EvaluateResponse, req: Req, res: Res, next: NextFunction) => void | Promise<void>;
  onBlock?: (decision: IdentityDecision, req: Req, res: Res, next: NextFunction) => void | Promise<void>;
  onDecision?: (decision: IdentityDecision, req: Req) => void | Promise<void>;
  onIntegrationError?: (error: unknown, req: Req, res: Res, next: NextFunction) => void | Promise<void>;
}
