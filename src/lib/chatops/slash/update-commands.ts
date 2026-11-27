import 'server-only';
/**
 * SlackOps updates: change an incident's title / description / priority / urgency and publish a
 * status-page update from Slack. Shared by the `/incident` subcommands and the modals. Never imports
 * slash-commands (which imports this file) so there is no module cycle.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { AppError, normalizeError } from '@/lib/errors';
import { escapeSlack } from '@/lib/chatops/squire/render';
import {
  authorizeChatOpsIncident,
  chatOpsLifecycleErrorMessage,
} from '@/lib/incidents/chatops-lifecycle';
import { normalizeIncidentPriority } from '@/lib/incidents/priority';
import type { IdempotencyContext } from '@/lib/idempotency';

export const UPDATE_SUBCOMMANDS: readonly string[] = [
  'priority',
  'urgency',
  'title',
  'describe',
  'status',
];

export type IncidentUpdateChanges = {
  title?: string;
  description?: string;
  priority?: string;
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH';
};
type Reply = { response_type: 'in_channel' | 'ephemeral'; text: string; replace_original?: false };

const ephemeral = (text: string): Reply => ({ response_type: 'ephemeral', text });
export const STATUS_MESSAGE_MAX = 2000;

/** Parses the arguments of one update subcommand; `error` is the ephemeral usage text. */
export function parseUpdateCommand(
  subcommand: string,
  args: string
): { changes: IncidentUpdateChanges } | { status: string } | { error: string } {
  const text = args.trim();
  switch (subcommand) {
    case 'priority': {
      const priority = normalizeIncidentPriority(text);
      return priority ? { changes: { priority } } : { error: 'Usage: `/incident priority P1-P5`' };
    }
    case 'urgency': {
      const urgency = text.toUpperCase();
      return urgency === 'HIGH' || urgency === 'MEDIUM' || urgency === 'LOW'
        ? { changes: { urgency } }
        : { error: 'Usage: `/incident urgency high|medium|low`' };
    }
    case 'title':
      return text.length >= 3 && text.length <= 200
        ? { changes: { title: text } }
        : { error: 'Usage: `/incident title <3-200 characters>`' };
    case 'describe':
      return text && text.length <= 3000
        ? { changes: { description: text } }
        : { error: 'Usage: `/incident describe <up to 3000 characters>`' };
    case 'status':
      return text.length >= 3 && text.length <= STATUS_MESSAGE_MAX
        ? { status: text }
        : { error: `Usage: \`/incident status <3-${STATUS_MESSAGE_MAX} characters>\`` };
    default:
      return { error: 'Unknown update command.' };
  }
}

/**
 * Applies the changed fields under the same MANAGE authorization as the other ChatOps edits, in one
 * transaction (the REST PATCH path, which also queues the live-card refresh). `lines` describe what
 * actually changed; empty means a no-op.
 */
export async function applyIncidentUpdate(input: {
  incidentId: string;
  actor: { id: string; name: string };
  changes: IncidentUpdateChanges;
  idempotency?: IdempotencyContext;
}): Promise<{ lines: string[] }> {
  await authorizeChatOpsIncident(input.incidentId, input.actor.id, 'MANAGE');
  const current = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { title: true, description: true, priority: true, urgency: true },
  });
  if (!current)
    throw new AppError({ code: 'INCIDENT_NOT_FOUND', userMessage: 'Incident not found.' });
  const { title, description, priority, urgency } = input.changes;
  const patch: IncidentUpdateChanges = {};
  const lines: string[] = [];
  if (priority && priority !== current.priority) {
    patch.priority = priority;
    lines.push(`Priority ${current.priority ?? 'none'} → ${priority}`);
  }
  if (urgency && urgency !== current.urgency) {
    patch.urgency = urgency;
    lines.push(`Urgency ${current.urgency} → ${urgency}`);
  }
  if (title && title !== current.title) {
    patch.title = title;
    lines.push('Title updated');
  }
  if (description !== undefined && description !== (current.description ?? '')) {
    patch.description = description;
    lines.push('Description updated');
  }
  if (lines.length === 0) return { lines };
  const { applyRestIncidentPatch } = await import('@/lib/incidents/rest-patch');
  await applyRestIncidentPatch({
    incidentId: input.incidentId,
    ...patch,
    hasAssigneeUpdate: false,
    actor: input.actor,
    ...(input.idempotency ? { idempotency: input.idempotency } : {}),
    inTx: async tx => {
      await tx.incidentEvent.create({
        data: {
          incidentId: input.incidentId,
          message: `Updated via Slack by ${input.actor.name}: ${lines.join('; ')}`,
        },
      });
    },
  });
  await replyInCardThread(
    input.incidentId,
    `✏️ ${lines.map(escapeSlack).join(' · ')} (by ${escapeSlack(input.actor.name)})`
  );
  return { lines };
}

/** Best-effort thread reply under the live incident card(s); a Slack failure never fails the update. */
async function replyInCardThread(incidentId: string, text: string): Promise<void> {
  try {
    const cards = await prisma.slackIncidentMessage.findMany({
      where: { incidentId, ts: { not: null }, channelId: { not: null } },
      select: { channelId: true, ts: true },
      take: 3,
    });
    if (cards.length === 0) return;
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { serviceId: true },
    });
    const { getSlackBotToken } = await import('@/lib/slack');
    const token = incident ? await getSlackBotToken(incident.serviceId) : null;
    if (!token) return;
    const { callSlackApi } = await import('@/lib/slack/api');
    for (const card of cards) {
      await callSlackApi('chat.postMessage', token, {
        channel: card.channelId,
        thread_ts: card.ts,
        text,
      });
    }
  } catch (error) {
    logger.warn('[SlackOps] Card thread reply failed', {
      incidentId,
      error: normalizeError(error).code,
    });
  }
}

/**
 * Publishes a status-page update for an incident, on every enabled status page that shows its service.
 * Same permission as the web announcement route (admin capability) and the same rules: private
 * incidents never reach a public page. Subscribers are notified only when asked.
 */
export async function postIncidentStatusUpdate(input: {
  incidentId: string;
  actor: { id: string; name: string };
  message: string;
  notifySubscribers?: boolean;
}): Promise<{ ok: true; pages: string[] } | { ok: false; reason: string }> {
  const { resolveUserActor } = await import('@/lib/authorization-actors');
  const { CAPABILITIES } = await import('@/lib/authorization');
  const actor = await resolveUserActor(input.actor.id);
  if (
    !actor ||
    actor.status !== 'ACTIVE' ||
    !actor.capabilities?.includes(CAPABILITIES.ADMIN_MANAGE)
  )
    return { ok: false, reason: 'You need admin access to publish status-page updates.' };
  await authorizeChatOpsIncident(input.incidentId, input.actor.id, 'READ');
  const incident = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { id: true, title: true, visibility: true, serviceId: true },
  });
  if (!incident) return { ok: false, reason: 'Incident not found.' };
  if (incident.visibility !== 'PUBLIC')
    return { ok: false, reason: 'This incident is internal, so it is not shown on a status page.' };
  const pages = await prisma.statusPage.findMany({
    where: {
      enabled: true,
      services: { some: { serviceId: incident.serviceId, showOnPage: true } },
    },
    select: { id: true, name: true },
    take: 5,
  });
  if (pages.length === 0)
    return { ok: false, reason: 'This incident’s service is not shown on an enabled status page.' };

  const { deriveAnnouncementNotificationPlan } =
    await import('@/lib/status-pages/announcement-notification-plan');
  const { createAnnouncementFanoutJob } = await import('@/lib/status-pages/announcement-commands');
  const { emitAuditEvent } = await import('@/lib/audit');
  const { Prisma } = await import('@prisma/client');
  const now = new Date();
  const timing = input.notifySubscribers ? 'ON_PUBLISH' : 'NONE';
  const plan = deriveAnnouncementNotificationPlan({
    isActive: true,
    notificationTiming: timing,
    publishAt: now,
    startDate: now,
  });
  await prisma.$transaction(async tx => {
    for (const page of pages) {
      const announcement = await tx.statusPageAnnouncement.create({
        data: {
          statusPageId: page.id,
          title: `Update: ${incident.title}`.slice(0, 200),
          message: input.message.trim(),
          type: 'INFO',
          startDate: now,
          publishAt: now,
          timeMode: 'EXACT',
          notificationTiming: timing,
          isActive: true,
          incidentId: incident.id,
          affectedServiceIds: [
            incident.serviceId,
          ] as unknown as import('@prisma/client').Prisma.InputJsonValue,
          affectedBusinessServiceIds: Prisma.JsonNull,
        },
      });
      if (plan.shouldNotify && plan.scheduledAt) {
        await createAnnouncementFanoutJob(tx, {
          announcementId: announcement.id,
          statusPageId: page.id,
          scheduledAt: plan.scheduledAt,
          generation: announcement.notificationGeneration,
          deliveryMode: 'ALL_ELIGIBLE',
        });
      }
      await emitAuditEvent(
        {
          action: 'status_page_announcement.created',
          source: 'INTEGRATION',
          target: { type: 'STATUS_PAGE', id: page.id },
          actor: { type: 'USER', id: input.actor.id },
          metadata: { announcementId: announcement.id, incidentId: incident.id, via: 'slack' },
        },
        tx
      );
    }
  });
  await prisma.incidentEvent.create({
    data: {
      incidentId: incident.id,
      message: `Status update published via Slack by ${input.actor.name}`,
    },
  });
  return { ok: true, pages: pages.map(page => page.name) };
}

export const statusUpdateConfirmation = (pages: string[], by: string) =>
  `📣 Status update published on ${pages.map(escapeSlack).join(', ')} by ${escapeSlack(by)}.`;

/** `/incident priority|urgency|title|describe|status ...` for the war-room channel's incident. */
export async function handleUpdateSlashCommand(input: {
  subcommand: string;
  args: string;
  incidentId: string;
  actor: { id: string; name: string };
  idempotency?: IdempotencyContext;
  /** Re-throws transient errors in the durable worker so the intent is retried. */
  rethrowIfTransient: (error: unknown) => void;
}): Promise<Reply> {
  const parsed = parseUpdateCommand(input.subcommand, input.args);
  if ('error' in parsed) return ephemeral(`ℹ️ ${parsed.error}`);
  try {
    if ('status' in parsed) {
      const result = await postIncidentStatusUpdate({
        incidentId: input.incidentId,
        actor: input.actor,
        message: parsed.status,
      });
      return result.ok
        ? {
            response_type: 'in_channel',
            text: statusUpdateConfirmation(result.pages, input.actor.name),
          }
        : ephemeral(`🚫 ${result.reason}`);
    }
    const { lines } = await applyIncidentUpdate({
      incidentId: input.incidentId,
      actor: input.actor,
      changes: parsed.changes,
      idempotency: input.idempotency,
    });
    return lines.length === 0
      ? ephemeral('ℹ️ Nothing to change: the incident already has that value.')
      : {
          response_type: 'in_channel',
          text: `✏️ ${lines.map(escapeSlack).join(' · ')} (by ${escapeSlack(input.actor.name)})`,
        };
  } catch (error) {
    logger.warn('[ChatOps] Slash update rejected', { incidentId: input.incidentId, error });
    input.rethrowIfTransient(error);
    return ephemeral(`⚠️ ${chatOpsLifecycleErrorMessage(error)}`);
  }
}
