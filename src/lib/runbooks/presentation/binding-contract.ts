/** Shared configuration contract; heartbeat/capability presence does not certify target permissions. */
import { requiresAgent, type RunbookStepType } from '../types';
function hasAgentActions(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 10) return false;
  const item = value as {
    type?: string;
    steps?: unknown[];
    precheck?: unknown;
    verification?: unknown;
  };
  return (
    (typeof item.type === 'string' && requiresAgent(item.type as RunbookStepType)) ||
    (Array.isArray(item.steps) && item.steps.some(step => hasAgentActions(step, depth + 1))) ||
    hasAgentActions(item.precheck, depth + 1) ||
    hasAgentActions(item.verification, depth + 1)
  );
}
export type BindingPresentation = { target: string; trigger: string; armed: boolean };
export type RunbookResource = 'bindings' | 'library' | 'agents' | 'pools';
export function describeBinding(
  binding: {
    enabled: boolean;
    mode: string;
    defaultAgentId: string | null;
    defaultAgentPoolId: string | null;
    agentSelector?: unknown;
    versionStrategy?: string;
    runbookVersion?: { definition: unknown } | null;
    runbook?: { publishedVersion: { definition: unknown } | null };
    triggers?: Array<{ enabled: boolean; event: string; conditions: unknown[] }>;
  },
  agents: Array<{ id: string; name: string }>,
  pools: Array<{ id: string; name: string }>,
  unavailable: RunbookResource[] = []
): BindingPresentation {
  const selector =
    binding.agentSelector &&
    typeof binding.agentSelector === 'object' &&
    !Array.isArray(binding.agentSelector)
      ? Object.entries(binding.agentSelector).filter(([, value]) => typeof value === 'string')
      : [];
  const target = binding.defaultAgentId
    ? unavailable.includes('agents')
      ? 'Agent inventory unavailable'
      : (agents.find(agent => agent.id === binding.defaultAgentId)?.name ?? 'Unavailable Agent')
    : binding.defaultAgentPoolId
      ? unavailable.includes('pools')
        ? 'Pool inventory unavailable'
        : (pools.find(pool => pool.id === binding.defaultAgentPoolId)?.name ?? 'Unavailable pool')
      : selector.length
        ? `Dynamic selector · ${selector.map(([key, value]) => `${key}=${value}`).join(', ')}`
        : hasAgentActions(
              binding.versionStrategy === 'PINNED'
                ? binding.runbookVersion?.definition
                : binding.runbook?.publishedVersion?.definition
            )
          ? 'Agent target missing'
          : 'Control plane';
  const enabledTriggers = (binding.triggers ?? []).filter(
    trigger => trigger.enabled && trigger.event === 'INCIDENT_CREATED'
  );
  const armed = binding.enabled && binding.mode !== 'MANUAL' && enabledTriggers.length > 0;
  const trigger = !binding.enabled
    ? 'Rule paused'
    : binding.mode === 'MANUAL'
      ? enabledTriggers.length
        ? 'Inactive in Manual mode'
        : 'Manual only'
      : enabledTriggers.length
        ? enabledTriggers
            .map(
              trigger =>
                `${trigger.event.replaceAll('_', ' ')} · ${trigger.conditions.length} conditions`
            )
            .join('; ')
        : 'No active trigger · Not armed';
  return { target, trigger, armed };
}
