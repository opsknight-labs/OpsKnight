/**
 * Provider-neutral ChatOps command types.
 *
 * Slack and Teams both translate an authenticated provider click into a
 * provider-neutral domain command; the incident domain executes it.
 * No provider-specific business logic lives in these types.
 */
import type { ChatProvider } from '@/lib/chatops/provider';
import type { IdempotencyContext } from '@/lib/idempotency';

export type ChatOpsProvider = ChatProvider;
export type ChatOpsSource = ChatProvider;

export type ChatOpsActor = {
  id: string;
  name: string;
};

export type ChatOpsLifecycleKind = 'ACKNOWLEDGE' | 'RESOLVE' | 'SNOOZE' | 'REOPEN' | 'UNACKNOWLEDGE' | 'UNSNOOZE';
export type ChatOpsKind = ChatOpsLifecycleKind | 'ASSIGN' | 'NOTE' | 'ESCALATE' | 'POSTMORTEM' | 'READ';

export type ChatOpsCommand =
  | { kind: 'ACKNOWLEDGE'; incidentId: string }
  | { kind: 'RESOLVE'; incidentId: string; resolutionNote?: string }
  | { kind: 'SNOOZE'; incidentId: string; snoozedUntil: Date; snoozeReason?: string | null }
  | { kind: 'REOPEN'; incidentId: string }
  | { kind: 'UNACKNOWLEDGE'; incidentId: string }
  | { kind: 'UNSNOOZE'; incidentId: string }
  | { kind: 'ASSIGN'; incidentId: string; targetUserId: string }
  | { kind: 'NOTE'; incidentId: string; content: string }
  | { kind: 'SET_PRIORITY'; incidentId: string; priority: string }
  | { kind: 'JOIN_RESPONDER'; incidentId: string }
  | { kind: 'ESCALATE'; incidentId: string }
  | { kind: 'POSTMORTEM'; incidentId: string; channelName: string }
  | { kind: 'READ'; incidentId: string };

export type ChatOpsCommandInput = {
  provider: ChatOpsProvider;
  actor: ChatOpsActor;
  command: ChatOpsCommand;
  idempotency?: IdempotencyContext;
  eventMessage?: string;
};

export type ChatOpsCommandResult =
  | { changed: true; status: string; incidentId: string }
  | { changed: false; status: string; incidentId: string }
  | { created: boolean; title: string; status: string; timelineCount: number; url: string }
  | { success: boolean; message?: string };

export type ChatOpsNoteInput = {
  incidentId: string;
  provider: ChatOpsProvider;
  actor: ChatOpsActor;
  content: string;
  idempotency?: IdempotencyContext;
};

export type ChatOpsAssignmentInput = {
  incidentId: string;
  provider: ChatOpsProvider;
  actor: ChatOpsActor;
  targetUserId: string;
  idempotency?: IdempotencyContext;
};

export const CHATOPS_PROVIDER_LABEL: Record<ChatProvider, string> = {
  SLACK: 'Slack',
  MICROSOFT_TEAMS: 'Microsoft Teams',
} as const;

export function chatOpsSourceLabel(provider: ChatProvider): string {
  return provider === 'SLACK' ? CHATOPS_PROVIDER_LABEL.SLACK : CHATOPS_PROVIDER_LABEL.MICROSOFT_TEAMS;
}
