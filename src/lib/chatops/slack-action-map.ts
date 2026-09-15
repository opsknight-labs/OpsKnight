/**
 * Slack adapter for the neutral ChatOps action contract.
 * Only 3 semantic kinds are surfaced in Slack; all others are omitted (fail-closed).
 */
import type { ChatOpsActionKind } from './action-contract';

type SlackActionId = 'ack_incident' | 'assign_me_incident' | 'resolve_incident';
type SlackActionValue = 'ack' | 'assign_me' | 'resolve';

const KIND_TO_SLACK: Partial<Record<ChatOpsActionKind, { actionId: SlackActionId; actionValue: SlackActionValue; label: string }>> = {
  ACKNOWLEDGE: { actionId: 'ack_incident', actionValue: 'ack', label: 'Acknowledge' },
  ASSIGN_SELF: { actionId: 'assign_me_incident', actionValue: 'assign_me', label: 'Assign to me' },
  RESOLVE: { actionId: 'resolve_incident', actionValue: 'resolve', label: 'Resolve' },
};

const SLACK_VALUE_TO_KIND: ReadonlyMap<string, ChatOpsActionKind> = new Map([
  ['ack', 'ACKNOWLEDGE'],
  ['assign_me', 'ASSIGN_SELF'],
  ['resolve', 'RESOLVE'],
] as const);

export function slackContractForKind(kind: ChatOpsActionKind): { actionId: string; actionValue: string; label: string } | null {
  return KIND_TO_SLACK[kind] ?? null;
}

export function kindForSlackValue(value: string): ChatOpsActionKind | null {
  return SLACK_VALUE_TO_KIND.get(value) ?? null;
}

export function isSlackSupportedKind(kind: string): boolean {
  return kind === 'ACKNOWLEDGE' || kind === 'ASSIGN_SELF' || kind === 'RESOLVE' || kind === 'ASSIGN_TO_ME';
}
