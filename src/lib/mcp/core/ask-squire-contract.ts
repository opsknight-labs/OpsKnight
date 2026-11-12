import { z } from 'zod/v4';
import { API_SCOPES, CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/**
 * The `ask_squire` contract, kept free of the assistant itself so the MCP server can list the tool
 * without loading Squire; the call imports `ask-squire.ts` on demand.
 *
 * Squire's core tools read incidents, services, on-call, teams, runbooks and postmortems under the
 * person's role and teams. A connection is offered the tool only when it was granted the read scopes
 * for all of those areas. An MCP turn may use only the read tools allowed here
 * (`askSquireAllowedTools`), so asking Squire never reads more than the connection could read itself;
 * a read tool added to Squire later stays out of MCP until it is listed.
 */
export const ASK_SQUIRE_SCOPES = [
  API_SCOPES.INCIDENTS_READ,
  API_SCOPES.SERVICES_READ,
  API_SCOPES.SCHEDULES_READ,
  API_SCOPES.TEAMS_READ,
  API_SCOPES.RUNBOOKS_READ,
  API_SCOPES.POSTMORTEMS_READ,
] as const;

/** Read tools covered by ASK_SQUIRE_SCOPES (incidents, services, on-call, runbooks, postmortems). */
export const ASK_SQUIRE_CORE_TOOLS = [
  'get_incident',
  'get_timeline',
  'list_alerts',
  'get_intelligence',
  'search_incidents',
  'semantic_search_incidents',
  'get_problem_outcomes',
  'incident_analytics',
  'get_service',
  'get_recent_changes',
  'who_is_on_call',
  'get_runbook',
  'get_runbook_steps',
  'search_postmortems',
] as const;

/** Read tools for an area outside ASK_SQUIRE_SCOPES, with the scope that unlocks each. */
export const ASK_SQUIRE_SCOPED_TOOLS: Readonly<Record<string, string>> = {
  // People directory: names and email addresses.
  find_people: API_SCOPES.USERS_READ,
  get_escalation_policy: API_SCOPES.ESCALATION_POLICIES_READ,
  get_status_page: API_SCOPES.STATUS_PAGES_READ,
  get_slo_status: API_SCOPES.SERVICE_OBJECTIVES_READ,
};

/**
 * Personal-class third-party text (raw alert payloads, the knowledge index built from notes and
 * postmortems): allowed over MCP only while the MCP policy allows sensitive reads.
 */
export const ASK_SQUIRE_SENSITIVE_TOOLS = ['get_alert_payload', 'search_knowledge'] as const;

// Observability connector tools (query_metrics, search_logs, get_traces, get_error_events,
// get_change_diff) reach external backends whose logs can hold customer personal data. No MCP scope
// covers them, so they are deliberately in none of the lists above and never run over MCP.

/** The Squire read tools an MCP turn may use, given the connection's scopes and the MCP policy. */
export function askSquireAllowedTools(
  scopes: readonly string[],
  options: { sensitiveReads: boolean }
): ReadonlySet<string> {
  const granted = new Set(scopes);
  const allowed = new Set<string>(ASK_SQUIRE_CORE_TOOLS);
  for (const [tool, scope] of Object.entries(ASK_SQUIRE_SCOPED_TOOLS))
    if (granted.has(scope)) allowed.add(tool);
  if (options.sensitiveReads) for (const tool of ASK_SQUIRE_SENSITIVE_TOOLS) allowed.add(tool);
  return allowed;
}

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
