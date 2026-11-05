import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  MCP_CATALOG,
  MCP_OPERATION_MAP,
  isMcpApprovalGated,
  isMcpExecutable,
  isMcpSensitiveRead,
} from '../catalog';
import { resolveDisabledMcpCapabilities } from '../catalog/capabilities';
import { missingConsentScopes } from '../core/execution';
import { POSTMORTEM_CONTEXT_OPERATIONS } from '../core/postmortem';

type Operation = (typeof MCP_CATALOG)[number];

/** Tools that read several operations at once (server.ts registers them only when all are visible). */
const COMPOSITE_TOOLS = new Map<string, readonly string[]>([
  ['incident_get_context', ['getIncident', 'getIncidentTimeline', 'listRelatedIncidents']],
  ['postmortem_get_context', POSTMORTEM_CONTEXT_OPERATIONS],
  ['oncall_for_service', ['getService', 'getEscalationPolicy', 'getScheduleOnCall']],
  ['incident_acknowledge_many', ['acknowledgeIncident']],
  // search and fetch read whichever kinds the connection can see; a missing kind is no failure.
]);
/** Generic tools whose `operationId` argument names the operation. */
const BY_OPERATION_ID = new Set(['read_operation', 'call_operation', 'operation_prepare']);
const CURATED_TOOLS = new Map(
  MCP_CATALOG.filter(operation => operation.tool).map(operation => [operation.tool!, operation])
);

/** The catalog operations a tools/call would run; empty when the call names none we know. */
function operationsOf(name: unknown, args: unknown): Operation[] {
  if (typeof name !== 'string') return [];
  const input = (args ?? {}) as { operationId?: unknown; steps?: unknown };
  const ids = BY_OPERATION_ID.has(name)
    ? [input.operationId]
    : name === 'execute_plan' && Array.isArray(input.steps)
      ? input.steps.map(step => (step as { operationId?: unknown } | null)?.operationId)
      : (COMPOSITE_TOOLS.get(name) ?? []);
  const found = ids
    .map(id => (typeof id === 'string' ? MCP_OPERATION_MAP.get(id) : undefined))
    .filter((operation): operation is Operation => Boolean(operation));
  const curated = CURATED_TOOLS.get(name);
  return curated ? [curated] : found;
}

/**
 * Scopes to ask for in a 403 insufficient_scope step-up challenge (MCP authorization, "Scope
 * Challenge Handling"), or null when the call should fail as a tool error instead.
 *
 * Only a permission a new consent could actually grant earns a challenge: the person's role
 * allows the operation (missingConsentScopes), the assistant's current client ceiling includes
 * every missing scope, and no administrator switch would refuse the call anyway (a disabled
 * capability, changes or sensitive reads turned off). The result keeps what the connection already
 * has, so a client that replaces its scopes with the challenge's loses nothing.
 */
export function stepUpScopes(
  actor: AuthorizationActor,
  input: {
    /** The assistant's current client ceiling: what a new consent for it could grant. */
    clientScopes: readonly string[];
    policy: {
      writesEnabled: boolean;
      sensitiveReadsEnabled: boolean;
      disabledCapabilities: readonly string[];
    };
    method: string;
    params: unknown;
  }
): string[] | null {
  if (input.method !== 'tools/call') return null;
  const params = (input.params ?? {}) as { name?: unknown; arguments?: unknown };
  const disabled = resolveDisabledMcpCapabilities(input.policy.disabledCapabilities);
  const missing = new Set<string>();
  for (const operation of operationsOf(params.name, params.arguments)) {
    if (
      disabled.has(operation.operationId) ||
      !(isMcpExecutable(operation) || isMcpApprovalGated(operation)) ||
      !(isMcpSensitiveRead(operation)
        ? input.policy.sensitiveReadsEnabled
        : operation.risk === 'R0' || input.policy.writesEnabled)
    )
      continue;
    for (const scope of missingConsentScopes(actor, operation)) missing.add(scope);
  }
  if (!missing.size || ![...missing].every(scope => input.clientScopes.includes(scope)))
    return null;
  const granted = actor.apiKey?.scopes ?? [];
  return [...new Set([...granted, ...missing])];
}
