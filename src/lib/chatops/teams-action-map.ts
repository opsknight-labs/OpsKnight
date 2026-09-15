/**
 * Teams adapter for the neutral ChatOps action contract.
 *
 * Neutral domain lives in action-contract.ts; this file owns the
 * Teams transport binding (Action.Execute verb ↔ semantic kind).
 * No neutral file imports from here.
 */
import { TEAMS_CHATOPS_VERBS, type TeamsChatOpsVerb } from '@/lib/microsoft-teams/action-schema';
import type { ChatOpsActionKind } from './action-contract';

const KIND_TO_VERB: Record<ChatOpsActionKind, TeamsChatOpsVerb> = {
  ACKNOWLEDGE: TEAMS_CHATOPS_VERBS.ACK,
  ASSIGN_SELF: TEAMS_CHATOPS_VERBS.ASSIGN_SELF,
  RESOLVE: TEAMS_CHATOPS_VERBS.RESOLVE,
  ADD_NOTE: TEAMS_CHATOPS_VERBS.NOTE,
  SET_PRIORITY: TEAMS_CHATOPS_VERBS.PRIORITY,
  SNOOZE: TEAMS_CHATOPS_VERBS.SNOOZE,
  ESCALATE: TEAMS_CHATOPS_VERBS.ESCALATE,
  JOIN_RESPONDER: TEAMS_CHATOPS_VERBS.JOIN_RESPONDER,
  VIEW_RESPONDERS: TEAMS_CHATOPS_VERBS.WHO,
  REFRESH: TEAMS_CHATOPS_VERBS.REFRESH,
};

const VERB_TO_KIND: ReadonlyMap<string, ChatOpsActionKind> = new Map(
  (Object.entries(KIND_TO_VERB) as Array<[ChatOpsActionKind, string]>).map(([k, v]) => [v, k]),
);

export function chatOpsKindForTeamsVerb(verb: string): ChatOpsActionKind | null {
  return VERB_TO_KIND.get(verb) ?? null;
}

export function teamsVerbForChatOpsKind(kind: ChatOpsActionKind): TeamsChatOpsVerb {
  return KIND_TO_VERB[kind];
}

export { TEAMS_CHATOPS_VERBS, type TeamsChatOpsVerb };
