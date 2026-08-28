import { AppError, type AppErrorCode } from '@/lib/errors';
import type { AuthorizationDecision } from '@/lib/authorization-policy';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';

type DeniedDecision = Extract<AuthorizationDecision, { allowed: false }>;

type AuthorizationErrorOptions = {
  forbiddenCode?: Extract<
    AppErrorCode,
    'AUTHORIZATION_DENIED' | 'SERVICE_ACCESS_DENIED' | 'INCIDENT_ACCESS_DENIED'
  >;
  forbiddenMessage: string;
};

/**
 * Converts the centralized authorization-policy decision into the public API
 * error contract. Policy remains the source of truth; routes only choose the
 * domain-specific forbidden code/message for resource denials.
 */
export function authorizationDecisionError(
  decision: DeniedDecision,
  options: AuthorizationErrorOptions
): AppError {
  if (decision.reason === 'ACTOR_INACTIVE') {
    return new AppError({
      code: 'API_KEY_USER_INVALID',
      userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
      details: { reason: decision.reason },
    });
  }

  if (decision.reason === 'MISSING_SCOPE') {
    return new AppError({
      code: 'API_SCOPE_REQUIRED',
      userMessage: `API key missing scope: ${decision.requiredScope}.`,
      details: { reason: decision.reason, requiredScope: decision.requiredScope },
    });
  }

  return new AppError({
    code: options.forbiddenCode ?? 'AUTHORIZATION_DENIED',
    userMessage: options.forbiddenMessage,
    details: {
      reason: decision.reason,
      requiredCapability: decision.requiredCapability,
    },
  });
}
