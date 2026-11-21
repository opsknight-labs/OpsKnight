import type { IncidentRoleSummary } from '@/lib/incidents/roles';
import {
  CHATOPS_ACTIONS,
  type ChatOpsActionKind,
  type ChatOpsCapabilityKey,
} from '@/lib/chatops/action-contract';

export type WarRoomProjectionPhase = 'TRIGGERED' | 'ACKNOWLEDGED' | 'RESOLVED';

/** Canonical war-room actions — superset of Slack + Teams. Provider renderers map this kind. */
export type WarRoomProjectionAction = ChatOpsActionKind;

export interface WarRoomMeetingProjection {
  provider: string;
  joinUrl: string;
  joinWebUrl?: string | null;
  conferenceId?: string | null;
  tollNumber?: string | null;
}

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
    /** Role holders in catalog order (commander first). */
    roles: IncidentRoleSummary[];
    url: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
  };
  phase: WarRoomProjectionPhase;
  actions: readonly WarRoomProjectionAction[];
  meeting?: WarRoomMeetingProjection | null;
}

function derivePhase(input: {
  status: string;
  acknowledgedAt?: Date | null;
}): WarRoomProjectionPhase {
  if (input.status === 'RESOLVED') return 'RESOLVED';
  if (input.acknowledgedAt || input.status === 'ACKNOWLEDGED') return 'ACKNOWLEDGED';
  return 'TRIGGERED';
}

function isAllowed(
  key: ChatOpsCapabilityKey | null,
  caps: Partial<Record<ChatOpsCapabilityKey, boolean>> | undefined
): boolean {
  if (key === null) return true;
  if (!caps) return true;
  // Explicit per-key check to avoid dynamic indexing (security/detect-object-injection)
  switch (key) {
    case 'canAcknowledge':
      return caps.canAcknowledge === true;
    case 'canResolve':
      return caps.canResolve === true;
    case 'canAssignSelf':
      return caps.canAssignSelf === true;
    case 'canAddNote':
      return caps.canAddNote === true;
    case 'canSetPriority':
      return caps.canSetPriority === true;
    case 'canSnooze':
      return caps.canSnooze === true;
    case 'canEscalate':
      return caps.canEscalate === true;
    case 'canJoinResponder':
      return caps.canJoinResponder === true;
    case 'canRead':
      return caps.canRead === true;
    case 'canTakeCommand':
      return caps.canTakeCommand === true;
    default:
      return false;
  }
}

function filterActionsByPhaseAndCapability(
  phase: WarRoomProjectionPhase,
  capabilities?: Partial<Record<ChatOpsCapabilityKey, boolean>>
): readonly ChatOpsActionKind[] {
  if (phase === 'RESOLVED') return [];
  const result: ChatOpsActionKind[] = [];
  for (const meta of Object.values(CHATOPS_ACTIONS) as Array<
    (typeof CHATOPS_ACTIONS)[ChatOpsActionKind]
  >) {
    if (meta.phases !== 'all') {
      if (
        Array.isArray(meta.phases) &&
        !meta.phases.includes(phase as 'TRIGGERED' | 'ACKNOWLEDGED')
      )
        continue;
    }
    if (!isAllowed(meta.capability, capabilities)) continue;
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
    roles?: IncidentRoleSummary[];
    url: string;
    createdAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
  },
  opts?: {
    capabilities?: Partial<Record<ChatOpsCapabilityKey, boolean>>;
    meeting?: WarRoomMeetingProjection | null;
  }
): WarRoomProjectionModel {
  const phase = derivePhase(input);
  const roles = input.roles ?? [];
  const hasCommander = roles.some(role => role.roleKey === 'COMMANDER');
  // Capability-gated path (Teams war-room) → full 10-action contract filtered by phase+cap.
  // Legacy fallback (no capabilities, e.g. Slack or old tests) → phase-correct 3-action set:
  //  TRIGGERED    → ACK + Assign (no Resolve until acknowledged)
  //  ACKNOWLEDGED → Assign + Resolve (ACK already done)
  //  …plus Take command while nobody holds the commander role.
  const baseActions: readonly WarRoomProjectionAction[] =
    opts?.capabilities !== undefined
      ? filterActionsByPhaseAndCapability(phase, opts.capabilities)
      : phase === 'RESOLVED'
        ? []
        : phase === 'ACKNOWLEDGED'
          ? (['ASSIGN_SELF', 'RESOLVE', 'TAKE_COMMAND'] as const)
          : (['ACKNOWLEDGE', 'ASSIGN_SELF', 'TAKE_COMMAND'] as const);
  const actions = hasCommander
    ? baseActions.filter(action => action !== 'TAKE_COMMAND')
    : baseActions;

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
      roles,
      url: input.url,
      createdAt: input.createdAt,
      acknowledgedAt: input.acknowledgedAt ?? null,
      resolvedAt: input.resolvedAt ?? null,
    },
    phase,
    actions,
    meeting: opts?.meeting ?? null,
  };
}

/** Capability-aware helper for Teams war-room call sites that already resolved IncidentChatOpsCapabilities. */
export function buildWarRoomProjectionForCapabilities(
  input: Parameters<typeof buildWarRoomProjection>[0],
  capabilities: Partial<Record<ChatOpsCapabilityKey, boolean>>,
  meeting?: WarRoomMeetingProjection | null
): WarRoomProjectionModel {
  return buildWarRoomProjection(input, { capabilities, meeting });
}
