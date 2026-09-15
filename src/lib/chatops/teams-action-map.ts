/**
 * Teams adapter for the neutral ChatOps action contract.
 *
 * Neutral domain lives in action-contract.ts; this file owns the
 * Teams transport binding (Action.Execute verb ↔ semantic kind).
 * No neutral file imports from here.
 */
import { TEAMS_CHATOPS_VERBS, type TeamsChatOpsVerb } from '@/lib/microsoft-teams/action-schema';
import type { ChatOpsActionKind } from './action-contract';

export function chatOpsKindForTeamsVerb(verb: string): ChatOpsActionKind | null {
  switch (verb) {
    case TEAMS_CHATOPS_VERBS.ACK:
      return 'ACKNOWLEDGE';
    case TEAMS_CHATOPS_VERBS.ASSIGN_SELF:
      return 'ASSIGN_SELF';
    case TEAMS_CHATOPS_VERBS.RESOLVE:
      return 'RESOLVE';
    case TEAMS_CHATOPS_VERBS.NOTE:
      return 'ADD_NOTE';
    case TEAMS_CHATOPS_VERBS.PRIORITY:
      return 'SET_PRIORITY';
    case TEAMS_CHATOPS_VERBS.SNOOZE:
      return 'SNOOZE';
    case TEAMS_CHATOPS_VERBS.ESCALATE:
      return 'ESCALATE';
    case TEAMS_CHATOPS_VERBS.JOIN_RESPONDER:
      return 'JOIN_RESPONDER';
    case TEAMS_CHATOPS_VERBS.WHO:
      return 'VIEW_RESPONDERS';
    case TEAMS_CHATOPS_VERBS.REFRESH:
      return 'REFRESH';
    default:
      return null;
  }
}

export function teamsVerbForChatOpsKind(kind: ChatOpsActionKind): TeamsChatOpsVerb {
  switch (kind) {
    case 'ACKNOWLEDGE':
      return TEAMS_CHATOPS_VERBS.ACK;
    case 'ASSIGN_SELF':
      return TEAMS_CHATOPS_VERBS.ASSIGN_SELF;
    case 'RESOLVE':
      return TEAMS_CHATOPS_VERBS.RESOLVE;
    case 'ADD_NOTE':
      return TEAMS_CHATOPS_VERBS.NOTE;
    case 'SET_PRIORITY':
      return TEAMS_CHATOPS_VERBS.PRIORITY;
    case 'SNOOZE':
      return TEAMS_CHATOPS_VERBS.SNOOZE;
    case 'ESCALATE':
      return TEAMS_CHATOPS_VERBS.ESCALATE;
    case 'JOIN_RESPONDER':
      return TEAMS_CHATOPS_VERBS.JOIN_RESPONDER;
    case 'VIEW_RESPONDERS':
      return TEAMS_CHATOPS_VERBS.WHO;
    case 'REFRESH':
      return TEAMS_CHATOPS_VERBS.REFRESH;
  }
}

export { TEAMS_CHATOPS_VERBS, type TeamsChatOpsVerb };
