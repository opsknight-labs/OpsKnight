/**
 * Provider-neutral ChatOps command dispatcher.
 *
 * Teams and Slack both translate an authenticated provider action into one of
 * these commands. The dispatcher owns no provider logic — it delegates to the
 * existing incident domain (`chatops-lifecycle`, `escalation/authorization`,
 * `chatops-postmortem`) which already enforces RBAC + resource scope inside
 * `runSerializableTransaction`.
 */
import 'server-only';

import { chatOpsSourceLabel, type ChatOpsCommandInput, type ChatOpsActor } from '@/lib/chatops/types';
import type { IdempotencyContext } from '@/lib/idempotency';

function providerEventMessage(provider: string, actorName: string, verb: string, extra?: string): string {
  const src = chatOpsSourceLabel(provider as never);
  const base = `${verb} via ${src} by ${actorName}`;
  return extra ? `${base}: ${extra}` : base;
}

export async function executeChatOpsCommand(input: ChatOpsCommandInput): Promise<unknown> {
  const { provider, actor, command, idempotency } = input;
  switch (command.kind) {
    case 'ACKNOWLEDGE':
      return executeAck(provider, actor, command.incidentId, idempotency, input.eventMessage);
    case 'RESOLVE':
      return executeResolve(provider, actor, command.incidentId, command.resolutionNote, idempotency, input.eventMessage);
    case 'SNOOZE':
      return executeSnooze(provider, actor, command.incidentId, command.snoozedUntil, command.snoozeReason ?? null, idempotency, input.eventMessage);
    case 'ASSIGN':
      return executeAssign(provider, actor, command.incidentId, command.targetUserId, idempotency);
    case 'NOTE':
      return executeNote(provider, actor, command.incidentId, command.content, idempotency);
    case 'SET_PRIORITY':
      return executePriority(provider, actor, command.incidentId, command.priority, idempotency);
    case 'JOIN_RESPONDER':
      return executeJoinResponder(provider, actor, command.incidentId, idempotency);
    case 'ESCALATE':
      return executeEscalate(provider, actor, command.incidentId, idempotency);
    case 'POSTMORTEM':
      return executePostmortem(provider, actor, command.incidentId, command.channelName, idempotency);
    case 'READ':
      return executeRead(actor, command.incidentId);
    default:
      throw new Error(`Unsupported ChatOps command: ${(command as { kind: string }).kind}`);
  }
}

async function executeAck(
  provider: string,
  actor: ChatOpsActor,
  incidentId: string,
  idempotency: IdempotencyContext | undefined,
  eventMessage: string | undefined
) {
  const { executeChatOpsLifecycleCommand } = await import('@/lib/incidents/chatops-lifecycle');
  return executeChatOpsLifecycleCommand({
    incidentId,
    command: 'ACKNOWLEDGE',
    actor,
    ...(idempotency ? { idempotency } : {}),
    eventMessage: eventMessage ?? providerEventMessage(provider, actor.name, 'Acknowledged'),
  });
}

async function executeResolve(
  provider: string,
  actor: ChatOpsActor,
  incidentId: string,
  resolutionNote: string | undefined,
  idempotency: IdempotencyContext | undefined,
  eventMessage: string | undefined
) {
  const { executeChatOpsLifecycleCommand } = await import('@/lib/incidents/chatops-lifecycle');
  const note = resolutionNote?.trim() ? resolutionNote.trim() : undefined;
  return executeChatOpsLifecycleCommand({
    incidentId,
    command: 'RESOLVE',
    actor,
    ...(idempotency ? { idempotency } : {}),
    ...(note ? { resolutionNote: note } : {}),
    eventMessage: eventMessage ?? providerEventMessage(provider, actor.name, 'Resolved', note),
  });
}

async function executeSnooze(
  provider: string,
  actor: ChatOpsActor,
  incidentId: string,
  snoozedUntil: Date,
  snoozeReason: string | null,
  idempotency: IdempotencyContext | undefined,
  eventMessage: string | undefined
) {
  const { executeChatOpsLifecycleCommand } = await import('@/lib/incidents/chatops-lifecycle');
  const minutes = Math.max(1, Math.round((snoozedUntil.getTime() - Date.now()) / 60000));
  return executeChatOpsLifecycleCommand({
    incidentId,
    command: 'SNOOZE',
    actor,
    ...(idempotency ? { idempotency } : {}),
    snoozedUntil,
    ...(snoozeReason ? { snoozeReason } : {}),
    eventMessage: eventMessage ?? providerEventMessage(provider, actor.name, `Snoozed for ${minutes}m`),
  });
}

async function executeAssign(
  provider: string,
  actor: ChatOpsActor,
  incidentId: string,
  targetUserId: string,
  idempotency: IdempotencyContext | undefined
) {
  const { executeChatOpsAssignment } = await import('@/lib/incidents/chatops-lifecycle');
  const p = provider === 'MICROSOFT_TEAMS' ? ('MICROSOFT_TEAMS' as const) : ('SLACK' as const);
  return executeChatOpsAssignment({ incidentId, actor, targetUserId, provider: p, ...(idempotency ? { idempotency } : {}) });
}

async function executeNote(
  provider: string,
  actor: ChatOpsActor,
  incidentId: string,
  content: string,
  idempotency: IdempotencyContext | undefined
) {
  const { executeChatOpsNote } = await import('@/lib/incidents/chatops-lifecycle');
  const p = provider === 'MICROSOFT_TEAMS' ? ('MICROSOFT_TEAMS' as const) : ('SLACK' as const);
  return executeChatOpsNote({ incidentId, actor, content, provider: p, ...(idempotency ? { idempotency } : {}) });
}

async function executeEscalate(provider: string, actor: ChatOpsActor, incidentId: string, idempotency: IdempotencyContext | undefined) {
  const { requestIncidentEscalation } = await import('@/lib/escalation/authorization');
  const source = provider === 'MICROSOFT_TEAMS' ? 'MICROSOFT_TEAMS' as const : 'SLACK' as const;
  return requestIncidentEscalation({ incidentId, actor: { userId: actor.id, name: actor.name }, source, ...(idempotency ? { idempotency } : {}) });
}

async function executePriority(provider: string, actor: ChatOpsActor, incidentId: string, priority: string, idempotency: IdempotencyContext | undefined) {
  const { executeChatOpsPriority } = await import('@/lib/incidents/chatops-lifecycle');
  return executeChatOpsPriority({ incidentId, actor, priority, provider: provider as 'SLACK' | 'MICROSOFT_TEAMS', ...(idempotency ? { idempotency } : {}) });
}

async function executeJoinResponder(provider: string, actor: ChatOpsActor, incidentId: string, idempotency: IdempotencyContext | undefined) {
  const { executeChatOpsJoinResponder } = await import('@/lib/incidents/chatops-lifecycle');
  return executeChatOpsJoinResponder({ incidentId, actor, provider: provider as 'SLACK' | 'MICROSOFT_TEAMS', ...(idempotency ? { idempotency } : {}) });
}

async function executePostmortem(
  provider: string,
  actor: ChatOpsActor,
  incidentId: string,
  channelName: string,
  idempotency: IdempotencyContext | undefined
) {
  const { executeChatOpsPostmortemCommand } = await import('@/lib/incidents/chatops-postmortem');
  void provider;
  return executeChatOpsPostmortemCommand({ incidentId, actor, channelName, ...(idempotency ? { idempotency } : {}) });
}

async function executeRead(actor: ChatOpsActor, incidentId: string) {
  const { authorizeChatOpsIncident } = await import('@/lib/incidents/chatops-lifecycle');
  await authorizeChatOpsIncident(incidentId, actor.id, 'READ');
  return { success: true, incidentId };
}
