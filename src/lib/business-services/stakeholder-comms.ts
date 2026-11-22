import 'server-only';

import type { IncidentUrgency, Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import { checkRateLimit } from '@/lib/rate-limit';
import { filterWatchersByCadence } from '@/lib/user-notifications';
import { assertCanManageBusinessServices } from './commands';

type Context = { actor: AuthorizationActor; source?: AuditEventSource };

export const SubscribersInputSchema = z
  .object({
    /** Teams whose members hear about this business service; replaces the current set. */
    teamIds: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
    /** Make every active user a follower (one-off: people who join later are not added). */
    subscribeAllUsers: z.boolean().optional(),
  })
  .strict();

/** Replaces a business service's team subscribers and optionally makes every user a follower. */
export async function setBusinessServiceSubscribers(
  businessServiceId: string,
  raw: unknown,
  context: Context
) {
  assertCanManageBusinessServices(context.actor);
  const input = SubscribersInputSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const exists = await tx.businessService.count({ where: { id: businessServiceId } });
    if (!exists)
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Business service not found.',
      });
    let teamIds: string[] | undefined;
    if (input.teamIds) {
      teamIds = [...new Set(input.teamIds)];
      if ((await tx.team.count({ where: { id: { in: teamIds } } })) !== teamIds.length)
        throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Team not found.' });
      await tx.businessServiceTeamSubscriber.deleteMany({
        where: { businessServiceId, teamId: { notIn: teamIds } },
      });
      await tx.businessServiceTeamSubscriber.createMany({
        data: teamIds.map(teamId => ({ businessServiceId, teamId })),
        skipDuplicates: true,
      });
    }
    let followersAdded = 0;
    if (input.subscribeAllUsers) {
      const users = await tx.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      followersAdded = (
        await tx.businessServiceFollower.createMany({
          data: users.map(user => ({ businessServiceId, userId: user.id })),
          skipDuplicates: true,
        })
      ).count;
    }
    await emitAuditEvent(
      {
        action: 'business_service.subscribers_updated',
        source: context.source ?? 'UI',
        target: { type: 'BUSINESS_SERVICE', id: businessServiceId },
        actor: { type: 'USER', id: context.actor.id },
        newValue: { teamIds: teamIds ?? null, subscribeAllUsers: Boolean(input.subscribeAllUsers) },
        metadata: { followersAdded },
      },
      tx
    );
    return { businessServiceId, teamIds: teamIds ?? null, followersAdded };
  });
}

export type StakeholderRecipient = {
  userId: string;
  email: string | null;
  businessServiceIds: string[];
};

/**
 * People who hear about these business services: followers plus members of subscribed teams
 * (who have not muted team notifications). Active users only; each person once.
 */
export async function stakeholderRecipients(
  businessServiceIds: readonly string[]
): Promise<StakeholderRecipient[]> {
  if (!businessServiceIds.length) return [];
  const ids = [...businessServiceIds];
  const [followers, teamSubscriptions] = await Promise.all([
    prisma.businessServiceFollower.findMany({
      where: { businessServiceId: { in: ids }, user: { status: 'ACTIVE' } },
      select: { businessServiceId: true, user: { select: { id: true, email: true } } },
    }),
    prisma.businessServiceTeamSubscriber.findMany({
      where: { businessServiceId: { in: ids } },
      select: {
        businessServiceId: true,
        team: {
          select: {
            members: {
              where: { receiveTeamNotifications: true, user: { status: 'ACTIVE' } },
              select: { user: { select: { id: true, email: true } } },
            },
          },
        },
      },
    }),
  ]);
  const byUser = new Map<string, StakeholderRecipient>();
  const add = (businessServiceId: string, user: { id: string; email: string | null }) => {
    const entry = byUser.get(user.id) ?? {
      userId: user.id,
      email: user.email,
      businessServiceIds: [],
    };
    if (!entry.businessServiceIds.includes(businessServiceId))
      entry.businessServiceIds.push(businessServiceId);
    byUser.set(user.id, entry);
  };
  for (const row of followers) add(row.businessServiceId, row.user);
  for (const row of teamSubscriptions)
    for (const member of row.team.members) add(row.businessServiceId, member.user);
  return [...byUser.values()];
}

export const STAKEHOLDER_UPDATE_PHASES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;

/** Stakeholder cadence event for each phase: every phase is a milestone stakeholders get. */
const CADENCE_EVENT: Record<(typeof STAKEHOLDER_UPDATE_PHASES)[number], string> = {
  investigating: 'triggered',
  identified: 'acknowledged',
  monitoring: 'acknowledged',
  resolved: 'resolved',
};

export const NotifyStakeholdersInputSchema = z
  .object({
    phase: z.enum(STAKEHOLDER_UPDATE_PHASES),
    message: z.string().trim().min(1).max(2000),
    /** Limit to some of the incident's impacted business services; default all of them. */
    businessServiceIds: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  })
  .strict();

/** At most this many stakeholder updates per incident per window, so nobody is spammed. */
export const STAKEHOLDER_NOTIFY_LIMIT = { count: 3, windowMs: 10 * 60_000 };

/**
 * Business services an incident impacts, from the engine's impact rows (unmarked ones left out).
 * An incident with no rows at all (older than the backfill, or not yet reconciled) is evaluated
 * now with the engine's own rules and thresholds, the same way the reconcile would write it.
 */
async function impactedBusinessServices(incident: {
  id: string;
  serviceId: string;
  urgency: IncidentUrgency;
  priority: string | null;
  createdAt: Date;
}) {
  const impacts = await prisma.incidentBusinessServiceImpact.findMany({
    where: { incidentId: incident.id },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    select: { excluded: true, businessService: { select: { id: true, name: true } } },
  });
  if (impacts.length) {
    // A pair can have several intervals; the latest one says whether it is unmarked.
    const latest = new Map(impacts.map(row => [row.businessService.id, row]));
    return [...latest.values()].filter(row => !row.excluded).map(row => row.businessService);
  }
  const { getHealthSnapshot, incidentImpactSources } = await import('./health');
  const snapshot = await getHealthSnapshot();
  const ids = [...incidentImpactSources({ ...snapshot.inputs, impactRows: [] }, incident).keys()];
  if (!ids.length) return [];
  return prisma.businessService.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Sends a templated update about an incident's business impact to the people who follow the
 * impacted business services (directly or through a subscribed team): email plus in-app, at
 * stakeholder cadence. Never pages, rate limited per incident, audited.
 */
export async function notifyIncidentStakeholders(
  incidentId: string,
  raw: unknown,
  context: Context,
  now = new Date(),
  /** Writes (in-app rows, email outbox, audit) commit with this transaction when given. */
  client?: Prisma.TransactionClient
) {
  const input = NotifyStakeholdersInputSchema.parse(raw);
  const store = client ?? prisma;
  const resource = await resolveIncidentResourceForActor(context.actor, incidentId);
  if (!resource) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  if (
    !authorize({ actor: context.actor, action: AUTHORIZATION_ACTIONS.INCIDENT_NOTE, resource })
      .allowed
  )
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      serviceId: true,
      priority: true,
      urgency: true,
      createdAt: true,
    },
  });
  if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });

  const impacted = await impactedBusinessServices(incident);
  const wanted = input.businessServiceIds ? new Set(input.businessServiceIds) : null;
  const targets = wanted ? impacted.filter(row => wanted.has(row.id)) : impacted;
  if (wanted && targets.length !== wanted.size)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Pick business services this incident impacts.',
    });
  if (!targets.length)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'This incident does not impact any business service yet.',
    });

  const limit = await checkRateLimit(
    `business-service-stakeholder-notify:${incident.id}`,
    STAKEHOLDER_NOTIFY_LIMIT.count,
    STAKEHOLDER_NOTIFY_LIMIT.windowMs
  );
  if (!limit.allowed)
    throw new AppError({
      code: 'RATE_LIMIT_EXCEEDED',
      userMessage: 'Stakeholders were updated recently. Try again in a few minutes.',
    });

  const nameById = new Map(targets.map(row => [row.id, row.name]));
  const recipients = filterRecipientsByCadence(
    await stakeholderRecipients([...nameById.keys()]),
    CADENCE_EVENT[input.phase],
    incident
  );
  const title = incident.title;
  const eventKey = `${now.getTime()}`;
  // One rendered message per distinct set of business services.
  const groups = new Map<string, StakeholderRecipient[]>();
  for (const recipient of recipients) {
    const key = JSON.stringify(recipient.businessServiceIds.sort());
    groups.set(key, [...(groups.get(key) ?? []), recipient]);
  }
  const [{ renderEmail }, { StakeholderUpdateEmail }, { emailBaseUrl }] = await Promise.all([
    import('@/emails/render'),
    import('@/emails/templates/stakeholder-update'),
    import('@/emails/utils'),
  ]);
  const base = emailBaseUrl();
  let emails = 0;
  for (const [key, members] of groups) {
    const names = (JSON.parse(key) as string[]).map(id => nameById.get(id)!);
    const subject = `[${names.join(', ')}] ${title}`;
    const text = `${names.join(', ')}: ${input.phase}\n\n${title}\n\n${input.message}`;
    await createInAppNotifications(
      {
        userIds: members.map(member => member.userId),
        type: 'INCIDENT',
        title: subject,
        message: input.message,
        entityType: 'INCIDENT',
        entityId: incident.id,
        dedupeKey: `business-service-stakeholders:${incident.id}:${eventKey}:${key}`,
      },
      store
    );
    const { html } = await renderEmail(
      StakeholderUpdateEmail({
        businessServiceNames: names,
        phase: input.phase,
        title,
        message: input.message,
        postedAt: now.toUTCString(),
        dashboardUrl: `${base}/status-dashboard`,
        settingsUrl: `${base}/settings/notifications`,
      }),
      { text }
    );
    for (const member of members) {
      if (!member.email) continue;
      await createCentralNotificationIntent(
        {
          userId: member.userId,
          channel: 'EMAIL',
          // Status-page traffic class: informational, never a page.
          category: 'STATUS_PAGE',
          recipientType: 'USER',
          recipientId: member.userId,
          recipientAddress: member.email,
          templateKey: 'BUSINESS_SERVICE_STAKEHOLDER_UPDATE',
          sourceType: 'INCIDENT',
          sourceId: incident.id,
          eventKey,
          displayMessage: subject,
          payload: { kind: 'EMAIL', to: member.email, subject, text, html },
        },
        store
      );
      emails += 1;
    }
  }
  await emitAuditEvent(
    {
      action: 'incident.stakeholders_notified',
      source: context.source ?? 'UI',
      target: { type: 'INCIDENT', id: incident.id },
      actor: { type: 'USER', id: context.actor.id },
      metadata: {
        phase: input.phase,
        businessServiceIds: [...nameById.keys()],
        recipientCount: recipients.length,
        emailCount: emails,
      },
    },
    client
  );
  return {
    incidentId: incident.id,
    businessServices: targets,
    recipientCount: recipients.length,
    emailCount: emails,
  };
}

/** Applies the stakeholder cadence per person (all recipients carry the STAKEHOLDER cadence). */
export function filterRecipientsByCadence(
  recipients: StakeholderRecipient[],
  eventType: string,
  incident: { priority?: string | null; urgency?: string | null }
) {
  const allowed = new Set(
    filterWatchersByCadence(
      recipients.map(recipient => ({ userId: recipient.userId, role: 'STAKEHOLDER' })),
      eventType,
      incident
    )
  );
  return recipients.filter(recipient => allowed.has(recipient.userId));
}
