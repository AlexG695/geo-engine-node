import { assertServerEnvironment } from './runtime.js';

assertServerEnvironment();

export { IdentityService, type IdentityServiceConfig } from './evaluate.js';
export { identityGuard } from './guard.js';
export {
  IdentityTransientError,
  IdentityIntegrationError,
  isTransient,
  type IdentityErrorFields,
} from './errors.js';
export type {
  LocationSource,
  IdentityLocation,
  IdentityContext,
  IdentitySubject,
  EvaluateRequest,
  EvaluateOptions,
  KnownDecision,
  Decision,
  EvaluateReason,
  KnownSignal,
  EvaluateSignal,
  RuleRef,
  ShadowMatch,
  Challenge,
  MetaSource,
  ReputationStatus,
  EvaluateMeta,
  EvaluateResponse,
  IdentityTransientReason,
  FallbackReason,
  IdentityIntegrationReason,
  FallbackDecision,
  IdentityDecision,
  GuardRequest,
  GuardResponse,
  NextFunction,
  IdentityGuardClient,
  IdentityGuardOptions,
} from './types.js';
