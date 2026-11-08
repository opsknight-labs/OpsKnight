import { z } from 'zod/v4';
import { API_SCOPES, CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/**
 * The `ask_squire` contract, kept free of the assistant itself so the MCP server can list the tool
 * without loading Squire; the call imports `ask-squire.ts` on demand.
 *
 * Squire's own tools read incidents, services, on-call, teams, runbooks and postmortems under the
 * person's role and teams. A connection is offered the tool only when it was granted the read scopes
 * for all of those areas, so asking Squire can never read more than the connection could read itself.
 */
export const ASK_SQUIRE_SCOPES = [
  API_SCOPES.INCIDENTS_READ,
  API_SCOPES.SERVICES_READ,
  API_SCOPES.SCHEDULES_READ,
  API_SCOPES.TEAMS_READ,
  API_SCOPES.RUNBOOKS_READ,
  API_SCOPES.POSTMORTEMS_READ,
] as const;

export const askSquireInputSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe('The question in plain language, e.g. "what changed before this started?".'),
    incidentId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional()
      .describe('Incident to ask about; an id the user cannot read is ignored.'),
  })
  .strict();

/** Registration gate (synchronous): role capability and every required scope granted. */
export function canAskSquire(actor: AuthorizationActor): boolean {
  if (actor.status !== 'ACTIVE') return false;
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return false;
  const scopes = new Set(actor.apiKey?.scopes ?? []);
  return ASK_SQUIRE_SCOPES.every(scope => scopes.has(scope));
}
