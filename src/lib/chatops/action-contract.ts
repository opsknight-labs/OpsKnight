/**
 * Central ChatOps action contract.
 *
 * One registry owns the semantic war-room actions. Provider adapters (Slack
 * block actions, Teams Action.Execute verbs) map their verb to this kind;
 * projection-model filters by phase + capability; cards derive button titles;
 * invoke validates + authorizes via the same capability key.
 *
 * Adding a new war-room action requires exactly one entry here — no other
 * file defines a separate action set.
 */
import { TEAMS_CHATOPS_VERBS } from '@/lib/microsoft-teams/action-schema';

export const CHATOPS_ACTION_KINDS = [
  'ACKNOWLEDGE',
  'ASSIGN_SELF',
  'RESOLVE',
  'ADD_NOTE',
  'SET_PRIORITY',
  'SNOOZE',
  'ESCALATE',
  'JOIN_RESPONDER',
  'VIEW_RESPONDERS',
  'REFRESH',
] as const;

export type ChatOpsActionKind = (typeof CHATOPS_ACTION_KINDS)[number];

export type ChatOpsCapabilityKey =
  | 'canAcknowledge'
  | 'canResolve'
  | 'canAssignSelf'
  | 'canAddNote'
  | 'canSetPriority'
  | 'canSnooze'
  | 'canEscalate'
  | 'canJoinResponder'
  | 'canRead';

export type ChatOpsActionMeta = {
  kind: ChatOpsActionKind;
  /** Capability gate for this action; null means always allowed when card is interactive. */
  capability: ChatOpsCapabilityKey | null;
  /** Phases in which the action is offered. 'all' means every non-terminal view. */
  phases: ReadonlyArray<'TRIGGERED' | 'ACKNOWLEDGED'> | 'all' | 'terminal_none';
  /** Whether invoking this action mutates incident domain state. */
  mutates: boolean;
  /** Input required from the card. */
  requiresInput?: 'note' | 'priority' | 'snooze' | 'resolutionNote';
  /** Teams Adaptive Card verb (stable, provider-specific). */
  teamsVerb: string;
  /** Human title rendered on the card. */
  title: string;
  /** Adaptive Cards `mode` hint. */
  mode?: 'secondary';
};

/**
 * Canonical registry — ordered as rendered. Projection filters this list by
 * phase + capability; cards iterate the filtered result; invoke maps verb → kind.
 */
export const CHATOPS_ACTIONS: Record<ChatOpsActionKind, ChatOpsActionMeta> = {
  ACKNOWLEDGE: {
    kind: 'ACKNOWLEDGE',
    capability: 'canAcknowledge',
    phases: ['TRIGGERED'],
    mutates: true,
    teamsVerb: TEAMS_CHATOPS_VERBS.ACK,
    title: 'Acknowledge',
  },
  ASSIGN_SELF: {
    kind: 'ASSIGN_SELF',
    capability: 'canAssignSelf',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    teamsVerb: TEAMS_CHATOPS_VERBS.ASSIGN_SELF,
    title: 'Assign to me',
  },
  RESOLVE: {
    kind: 'RESOLVE',
    capability: 'canResolve',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'resolutionNote',
    teamsVerb: TEAMS_CHATOPS_VERBS.RESOLVE,
    title: 'Resolve',
  },
  ESCALATE: {
    kind: 'ESCALATE',
    capability: 'canEscalate',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    teamsVerb: TEAMS_CHATOPS_VERBS.ESCALATE,
    title: 'Escalate',
  },
  ADD_NOTE: {
    kind: 'ADD_NOTE',
    capability: 'canAddNote',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'note',
    teamsVerb: TEAMS_CHATOPS_VERBS.NOTE,
    title: 'Add note',
    mode: 'secondary',
  },
  SET_PRIORITY: {
    kind: 'SET_PRIORITY',
    capability: 'canSetPriority',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'priority',
    teamsVerb: TEAMS_CHATOPS_VERBS.PRIORITY,
    title: 'Priority',
    mode: 'secondary',
  },
  SNOOZE: {
    kind: 'SNOOZE',
    capability: 'canSnooze',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'snooze',
    teamsVerb: TEAMS_CHATOPS_VERBS.SNOOZE,
    title: 'Snooze',
    mode: 'secondary',
  },
  JOIN_RESPONDER: {
    kind: 'JOIN_RESPONDER',
    capability: 'canJoinResponder',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    teamsVerb: TEAMS_CHATOPS_VERBS.JOIN_RESPONDER,
    title: 'Join as responder',
    mode: 'secondary',
  },
  VIEW_RESPONDERS: {
    kind: 'VIEW_RESPONDERS',
    capability: 'canRead',
    phases: 'all',
    mutates: false,
    teamsVerb: TEAMS_CHATOPS_VERBS.WHO,
    title: 'Current responders',
    mode: 'secondary',
  },
  REFRESH: {
    kind: 'REFRESH',
    capability: null,
    phases: 'all',
    mutates: false,
    teamsVerb: TEAMS_CHATOPS_VERBS.REFRESH,
    title: 'Refresh',
    mode: 'secondary',
  },
} as const;

const VERB_TO_KIND: ReadonlyMap<string, ChatOpsActionKind> = new Map(
  (Object.values(CHATOPS_ACTIONS) as ChatOpsActionMeta[]).map(meta => [meta.teamsVerb, meta.kind]),
);

export function chatOpsKindForTeamsVerb(verb: string): ChatOpsActionKind | null {
  return VERB_TO_KIND.get(verb) ?? null;
}

export function isChatOpsActionKind(value: string): value is ChatOpsActionKind {
  return (CHATOPS_ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * Map a semantic kind to the incident-domain ChatOpsCommand kind.
 * Returns null for REFRESH/VIEW_RESPONDERS which are read/refresh only.
 */
export function chatOpsCommandKindForActionKind(
  kind: ChatOpsActionKind,
): 'ACKNOWLEDGE' | 'ASSIGN' | 'RESOLVE' | 'NOTE' | 'SET_PRIORITY' | 'SNOOZE' | 'ESCALATE' | 'JOIN_RESPONDER' | 'READ' | null {
  switch (kind) {
    case 'ACKNOWLEDGE':
      return 'ACKNOWLEDGE';
    case 'ASSIGN_SELF':
      return 'ASSIGN';
    case 'RESOLVE':
      return 'RESOLVE';
    case 'ADD_NOTE':
      return 'NOTE';
    case 'SET_PRIORITY':
      return 'SET_PRIORITY';
    case 'SNOOZE':
      return 'SNOOZE';
    case 'ESCALATE':
      return 'ESCALATE';
    case 'JOIN_RESPONDER':
      return 'JOIN_RESPONDER';
    case 'VIEW_RESPONDERS':
      return 'READ';
    case 'REFRESH':
      return 'READ';
    default:
      return null;
  }
}
