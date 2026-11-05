import { API_SCOPES } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';

export const MCP_REVIEWED_RUNBOOK_SCOPES = [
  API_SCOPES.RUNBOOKS_EXECUTE,
  API_SCOPES.RUNBOOKS_READ,
  API_SCOPES.INCIDENTS_READ,
  API_SCOPES.SERVICES_READ,
] as const;

export function canUseReviewedRunbooks(actor: AuthorizationActor) {
  return (
    MCP_REVIEWED_RUNBOOK_SCOPES.every(scope => actor.apiKey?.scopes.includes(scope)) &&
    authorize({ actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE }).allowed
  );
}

/**
 * Open requests one connection may have waiting at once, shared by change and runbook prepares,
 * so a looping assistant cannot flood reviewers with notices.
 */
export const MAX_PENDING_PER_GRANT = 20;
