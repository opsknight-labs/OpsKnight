import { CHATOPS_ACTIONS, type ChatOpsActionKind, type ChatOpsCapabilityKey } from '@/lib/chatops/action-contract';

export type WarRoomProjectionPhase = 'TRIGGERED' | 'ACKNOWLEDGED' | 'RESOLVED';

/** Canonical war-room actions — superset of Slack + Teams. Provider renderers map this kind. */
export type WarRoomProjectionAction = ChatOpsActionKind;

export interface WarRoomProjectionModel {
  version: 1;
  incident: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    urgency: string;
    priority: string | null;
    serviceName: string;
    assigneeName: string | null;
    url: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
  };
  phase: WarRoomProjectionPhase;
  actions: readonly WarRoomProjectionAction[];
}

function derivePhase(input: { status: string; acknowledgedAt?: Date | null }): WarRoomProjectionPhase {
  if (input.status === 'RESOLVED') return 'RESOLVED';
  if (input.acknowledgedAt || input.status === 'ACKNOWLEDGED') return 'ACKNOWLEDGED';
  return 'TRIGGERED';
}

function filterActionsByPhaseAndCapability(
  phase: WarRoomProjectionPhase,
  capabilities?: Partial<Record<ChatOpsCapabilityKey, boolean>>,
): readonly ChatOpsActionKind[] {
  if (phase === 'RESOLVED') return [];
  const allow = (key: ChatOpsCapabilityKey | null): boolean => {
    if (!key) return true;
    if (!capabilities) return true;
    return capabilities[key] === true;
  };
  const result: ChatOpsActionKind[] = [];
  for (const meta of Object.values(CHATOPS_ACTIONS) as Array<(typeof CHATOPS_ACTIONS)[ChatOpsActionKind]>) {
    if (meta.phases !== 'all') {
      if (Array.isArray(meta.phases) && !meta.phases.includes(phase as 'TRIGGERED' | 'ACKNOWLEDGED')) continue;
    }
    if (!allow(meta.capability)) continue;
    result.push(meta.kind);
  }
  return result;
}

export function buildWarRoomProjection(
  input: {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    urgency: string;
    priority?: string | null;
    serviceName: string;
    assigneeName?: string | null;
    url: string;
    createdAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
  },
  opts?: { capabilities?: Partial<Record<ChatOpsCapabilityKey, boolean>> },
): WarRoomProjectionModel {
  const phase = derivePhase(input);
  // Transitional compatibility: callers that do not pass capabilities still
  // receive the legacy 3-action set so Slack + existing tests remain stable.
  // Callers that pass capabilities (Teams war-room path) receive the full
  // capability-gated 10-action contract.
  const actions: readonly WarRoomProjectionAction[] = opts?.capabilities
    ? filterActionsByPhaseAndCapability(phase, opts.capabilities)
    : phase === 'RESOLVED'
      ? []
      : (['ACKNOWLEDGE', 'ASSIGN_SELF', 'RESOLVE'] as const);

  return {
    version: 1,
    incident: {
      id: input.id,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      urgency: input.urgency,
      priority: input.priority ?? null,
      serviceName: input.serviceName,
      assigneeName: input.assigneeName ?? null,
      url: input.url,
      createdAt: input.createdAt,
      acknowledgedAt: input.acknowledgedAt ?? null,
      resolvedAt: input.resolvedAt ?? null,
    },
    phase,
    actions,
  };
}

/** Capability-aware helper for Teams war-room call sites that already resolved IncidentChatOpsCapabilities. */
export function buildWarRoomProjectionForCapabilities(
  input: Parameters<typeof buildWarRoomProjection>[0],
  capabilities: Partial<Record<ChatOpsCapabilityKey, boolean>>,
): WarRoomProjectionModel {
  return buildWarRoomProjection(input, { capabilities });
}
