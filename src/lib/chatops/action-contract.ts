/**
 * Central ChatOps action contract — provider-neutral.
 *
 * One registry owns the semantic war-room actions. Provider adapters
 * (src/lib/chatops/teams-action-map.ts, src/lib/chatops/slack-action-map.ts)
 * map their transport verbs to this kind; projection-model filters by phase +
 * capability; cards derive titles/modes; invoke authorizes via the same
 * capability key.
 *
 * Adding a new war-room action requires exactly one entry here —
 * no provider file defines a separate action set.
 */

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
  /** Human title rendered on the card. */
  title: string;
  /** Adaptive Cards `mode` hint. */
  mode?: 'secondary';
};

/**
 * Canonical registry — ordered as rendered. Projection filters this list by
 * phase + capability; cards iterate the filtered result.
 *
 * Phase policy (P1-8):
 *  TRIGGERED    → ACK / Assign / Escalate / Note / Priority / Snooze
 *  ACKNOWLEDGED → Resolve / Assign / Escalate / Note / Priority / Snooze
 *  RESOLVED     → (none)
 *  REFRESH + VIEW_RESPONDERS → 'all' (non-terminal)
 */
export const CHATOPS_ACTIONS: Record<ChatOpsActionKind, ChatOpsActionMeta> = {
  ACKNOWLEDGE: {
    kind: 'ACKNOWLEDGE',
    capability: 'canAcknowledge',
    phases: ['TRIGGERED'],
    mutates: true,
    title: 'Acknowledge',
  },
  ASSIGN_SELF: {
    kind: 'ASSIGN_SELF',
    capability: 'canAssignSelf',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    title: 'Assign to me',
  },
  RESOLVE: {
    kind: 'RESOLVE',
    capability: 'canResolve',
    phases: ['ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'resolutionNote',
    title: 'Resolve',
  },
  ESCALATE: {
    kind: 'ESCALATE',
    capability: 'canEscalate',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    title: 'Escalate',
  },
  ADD_NOTE: {
    kind: 'ADD_NOTE',
    capability: 'canAddNote',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'note',
    title: 'Add note',
    mode: 'secondary',
  },
  SET_PRIORITY: {
    kind: 'SET_PRIORITY',
    capability: 'canSetPriority',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'priority',
    title: 'Priority',
    mode: 'secondary',
  },
  SNOOZE: {
    kind: 'SNOOZE',
    capability: 'canSnooze',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    requiresInput: 'snooze',
    title: 'Snooze',
    mode: 'secondary',
  },
  JOIN_RESPONDER: {
    kind: 'JOIN_RESPONDER',
    capability: 'canJoinResponder',
    phases: ['TRIGGERED', 'ACKNOWLEDGED'],
    mutates: true,
    title: 'Join as responder',
    mode: 'secondary',
  },
  VIEW_RESPONDERS: {
    kind: 'VIEW_RESPONDERS',
    capability: 'canRead',
    phases: 'all',
    mutates: false,
    title: 'Current responders',
    mode: 'secondary',
  },
  REFRESH: {
    kind: 'REFRESH',
    capability: null,
    phases: 'all',
    mutates: false,
    title: 'Refresh',
    mode: 'secondary',
  },
} as const;

export function isChatOpsActionKind(value: string): value is ChatOpsActionKind {
  return (CHATOPS_ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * Map a semantic kind to the incident-domain ChatOpsCommand kind.
 * VIEW_RESPONDERS and REFRESH map to READ (non-mutating).
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
