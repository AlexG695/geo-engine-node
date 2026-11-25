import { IdentityIntegrationError, isTransient } from './errors.js';
import { assertServerEnvironment } from './runtime.js';
import type {
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResponse,
  FallbackDecision,
  FallbackReason,
  GuardRequest,
  GuardResponse,
  IdentityDecision,
  IdentityGuardClient,
  IdentityGuardOptions,
  NextFunction,
} from './types.js';

function resolveEvaluateFn(
  client: IdentityGuardClient
): (request: EvaluateRequest, options?: EvaluateOptions) => Promise<EvaluateResponse> {
  if (
    client &&
    typeof client === 'object' &&
    'identity' in client &&
    client.identity &&
    typeof client.identity.evaluate === 'function'
  ) {
    return client.identity.evaluate.bind(client.identity);
  }
  if (client && typeof client === 'object' && 'evaluate' in client && typeof client.evaluate === 'function') {
    return client.evaluate.bind(client);
  }
  throw new IdentityIntegrationError({
    message: 'identityGuard: client debe exponer identity.evaluate() o evaluate()',
    reason: 'configuration_error',
  });
}

function isResponseSent(res: GuardResponse): boolean {
  return Boolean(res.headersSent || res.writableEnded);
}

function sendJson(res: GuardResponse, statusCode: number, body: unknown): void {
  if (isResponseSent(res)) {
    return;
  }

  if (typeof res.status === 'function') {
    const result = res.status(statusCode);
    if (result && typeof result.json === 'function') {
      result.json(body);
      return;
    }
  }

  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  if (typeof res.json === 'function') {
    res.json(body);
    return;
  }
  if (typeof res.end === 'function') {
    res.end(JSON.stringify(body));
  }
}

function buildFallbackDecision(
  failOpen: boolean,
  fallbackReason: FallbackReason,
  requestId?: string
): FallbackDecision {
  return {
    decision: failOpen ? 'ALLOW' : 'BLOCK',
    matched_rule: null,
    default_applied: false,
    reason: 'SDK_FALLBACK',
    signals: [],
    shadow_matches: [],
    fallback: true,
    fallback_reason: fallbackReason,
    meta: {
      config_version: 0,
      stale: true,
      config_age_s: 0,
      source: 'sdk_fallback',
      evaluated_at: new Date().toISOString(),
      ...(requestId ? { request_id: requestId } : {}),
    },
  };
}

/**
 * Express/Connect middleware that protects routes using `POST /v1/evaluate`.
 * `failOpen` is mandatory (boolean) and has no default value.
 */
export function identityGuard<
  Req extends GuardRequest = GuardRequest,
  Res extends GuardResponse = GuardResponse,
>(
  options: IdentityGuardOptions<Req, Res>
): (req: Req, res: Res, next: NextFunction) => void {
  assertServerEnvironment();

  if (!options || typeof options !== 'object') {
    throw new IdentityIntegrationError({
      message: 'identityGuard: las opciones son obligatorias',
      reason: 'configuration_error',
    });
  }

  if (typeof options.failOpen !== 'boolean') {
    throw new IdentityIntegrationError({
      message: 'identityGuard: la opción failOpen (boolean) es obligatoria y no tiene valor por defecto',
      reason: 'configuration_error',
    });
  }

  if (typeof options.scope !== 'string' || options.scope.trim().length === 0) {
    throw new IdentityIntegrationError({
      message: 'identityGuard: scope es obligatorio y debe ser una cadena no vacía',
      reason: 'configuration_error',
    });
  }

  if (typeof options.getSubject !== 'function') {
    throw new IdentityIntegrationError({
      message: 'identityGuard: getSubject es obligatorio y debe ser una función',
      reason: 'configuration_error',
    });
  }

  const evaluate = resolveEvaluateFn(options.client);
  const {
    scope,
    getSubject,
    getContext,
    failOpen,
    timeoutMs,
    onChallenge,
    onBlock,
    onDecision,
    onIntegrationError,
  } = options;

  return (req: Req, res: Res, next: NextFunction): void => {
    const handleIntegrationFailure = async (err: unknown): Promise<void> => {
      if (onIntegrationError) {
        try {
          await onIntegrationError(err, req, res, next);
        } catch {
          // Hook failures must not bypass generic 500 error handling
        }
      }
      sendJson(res, 500, { error: 'internal_error' });
    };

    const handleBlock = async (decision: IdentityDecision): Promise<void> => {
      if (onBlock) {
        await onBlock(decision, req, res, next);
        return;
      }
      sendJson(res, 403, { error: 'access_denied' });
    };

    const handleFallback = async (
      fallbackReason: FallbackReason,
      requestId?: string
    ): Promise<void> => {
      const synthetic = buildFallbackDecision(failOpen, fallbackReason, requestId);
      if (onDecision) {
        await onDecision(synthetic, req);
      }
      if (failOpen) {
        next();
        return;
      }
      await handleBlock(synthetic);
    };

    void (async () => {
      try {
        assertServerEnvironment();

        const subject = await getSubject(req);
        const context = getContext ? await getContext(req) : undefined;
        const evaluateOptions = timeoutMs !== undefined ? { timeoutMs } : undefined;

        let response: EvaluateResponse;
        try {
          response = await evaluate({ scope, subject, context }, evaluateOptions);
        } catch (err: unknown) {
          if (isTransient(err)) {
            await handleFallback(err.reason, err.requestId);
            return;
          }
          await handleIntegrationFailure(err);
          return;
        }

        if (response.decision === 'ALLOW') {
          if (onDecision) {
            await onDecision(response, req);
          }
          next();
          return;
        }

        if (response.decision === 'BLOCK') {
          if (onDecision) {
            await onDecision(response, req);
          }
          await handleBlock(response);
          return;
        }

        if (response.decision === 'CHALLENGE') {
          if (onDecision) {
            await onDecision(response, req);
          }
          if (onChallenge) {
            await onChallenge(response, req, res, next);
            return;
          }
          sendJson(res, 403, {
            error: 'challenge_required',
            hint: response.challenge?.hint || 'step_up',
          });
          return;
        }

        await handleFallback('unknown_decision', response.meta?.request_id);
      } catch (err: unknown) {
        await handleIntegrationFailure(err);
      }
    })();
  };
}
