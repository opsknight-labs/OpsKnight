import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';

/**
 * Revenue, customer counts and downtime cost are visible only to actors who can manage
 * operations (OPERATIONS_MANAGE or ADMIN); read-scoped actors never see them.
 */
export function canReadBusinessServiceFinancials(actor: AuthorizationActor): boolean {
  return authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_CREATE }).allowed;
}
