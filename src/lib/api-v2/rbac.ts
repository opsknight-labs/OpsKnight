import { AppError } from '@/lib/errors';
import {
  authorize,
  type AuthorizationAction,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';

export function enforceV2Authorization(
  actor: AuthorizationActor,
  action: AuthorizationAction,
  resource?: AuthorizationResource
): void {
  const decision = authorize({ actor, action, resource });

  if (decision.allowed) {
    return;
  }

  switch (decision.reason) {
    case 'ACTOR_INACTIVE':
      throw new AppError({
        code: 'USER_DISABLED',
        userMessage: 'The authenticated user or service account is disabled or inactive.',
        details: { actorId: actor.id, status: actor.status },
      });

    case 'MISSING_SCOPE':
      throw new AppError({
        code: 'API_SCOPE_REQUIRED',
        userMessage: `This operation requires the API scope '${decision.requiredScope}'.`,
        details: {
          requiredScope: decision.requiredScope,
          grantedScopes: actor.apiKey?.scopes ?? [],
        },
      });

    case 'RESOURCE_OUT_OF_SCOPE':
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'You do not have permission to access or modify this specific resource.',
        details: {
          action,
          requiredCapability: decision.requiredCapability,
        },
      });

    case 'MISSING_CAPABILITY':
    default:
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: `Role '${actor.role}' lacks the required capability to perform action '${action}'.`,
        details: {
          role: actor.role,
          requiredCapability: decision.requiredCapability,
        },
      });
  }
}

export function hasV2Scope(actor: AuthorizationActor, scope: string): boolean {
  if (!actor.apiKey) return true;
  if (actor.apiKey.scopes.includes('admin:manage')) return true;
  return actor.apiKey.scopes.includes(scope);
}

