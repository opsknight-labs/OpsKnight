import { getAutomationSettings } from './settings';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { persistObservationBatch } from './observation-batch';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import { enqueueMicrosoftTeamsDeliveryInTransaction } from '@/lib/microsoft-teams/delivery';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
const observationSchema = z
  .object({
    key: z.string().max(64),
    path: z.string().max(512),
    value: z.string().max(256),
    type: z.string().max(16),
    unmapped: z.boolean(),
  })
  .strict();
const jobSchema = z.discriminatedUnion('task', [
  z
    .object({
      task: z.literal('AUTOMATION_NOTIFY'),
      incidentId: z.string(),
      serviceId: z.string(),
      versionId: z.string(),
      type: z.literal('NOTIFY_CHANNEL'),
      ruleId: z.string(),
      provider: z.enum(['SLACK', 'TEAMS']),
      destinationId: z.string(),
      logicalKey: z.string(),
    })
    .strict(),
  z
    .object({
      task: z.literal('AUTOMATION_OBSERVE'),
      logicalKey: z.string().min(1).max(200),
      serviceId: z.string(),
      integrationId: z.string(),
      integrationType: z.string(),
      observations: z.array(observationSchema).max(64),
      shadow: z
        .object({
          versionId: z.string(),
          bucketDate: z.string().datetime(),
          evaluated: z.number().int().nonnegative(),
          same: z.number().int().nonnegative(),
          priorityDifferent: z.number().int().nonnegative(),
          routeDifferent: z.number().int().nonnegative(),
          noEscalationDifferent: z.number().int().nonnegative(),
          errors: z.number().int().nonnegative(),
          fallbacks: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({ task: z.literal('AUTOMATION_RETENTION'), cutoff: z.string().datetime().optional() })
    .strict(),
]);
export type ObservationJob = Extract<z.infer<typeof jobSchema>, { task: 'AUTOMATION_OBSERVE' }>;
export async function processAutomationJob(payload: unknown) {
  const job = jobSchema.parse(payload);
  if (job.task === 'AUTOMATION_RETENTION') {
    const requested = (await getAutomationSettings()).automationTraceRetentionDays;
    const days = Number.isFinite(requested) ? Math.max(1, Math.min(3650, requested)) : 90;
    const configuredCutoff = Date.now() - days * 86400000;
    const before = new Date(
      Math.min(job.cutoff ? Date.parse(job.cutoff) : configuredCutoff, configuredCutoff)
    );
    // Each job spends at most one bounded batch on maintenance. Deletion and
    // continuation share a transaction: a crash cannot strand the expired backlog.
    await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-retention', 0))`;
        const traces = await tx.automationTrace.findMany({
          where: { evaluationAt: { lt: before } },
          select: { id: true },
          orderBy: [{ evaluationAt: 'asc' }, { id: 'asc' }],
          take: 1000,
        });
        await tx.automationTrace.deleteMany({ where: { id: { in: traces.map(t => t.id) } } });
        const observations = await tx.automationContextObservation.findMany({
          where: { lastSeenAt: { lt: before } },
          select: { id: true },
          orderBy: [{ lastSeenAt: 'asc' }, { id: 'asc' }],
          take: 1000,
        });
        await tx.automationContextObservation.deleteMany({
          where: { id: { in: observations.map(o => o.id) } },
        });
        if (traces.length === 1000 || observations.length === 1000) {
          await tx.backgroundJob.create({
            data: {
              type: 'SCHEDULED_TASK',
              scheduledAt: new Date(),
              maxAttempts: 5,
              payload: { task: 'AUTOMATION_RETENTION', cutoff: before.toISOString() },
            },
          });
        }
      },
      { timeout: 10000 }
    );
    return;
  }
  if (job.task === 'AUTOMATION_OBSERVE') {
    // Idempotency lives in the transaction: a crash/retry cannot count observations twice.
    const recorded = await prisma.$transaction(
      tx =>
        persistObservationBatch(tx, job, payload => {
          const parsed = jobSchema.safeParse(payload);
          return parsed.success && parsed.data.task === 'AUTOMATION_OBSERVE' ? parsed.data : null;
        }),
      { timeout: 10000 }
    );
    if (!recorded) return;
    const unmapped = job.observations.filter(o => o.unmapped);
    if (unmapped.length)
      logger.info('automation.context.unmapped', {
        serviceId: job.serviceId,
        fields: unmapped.map(field => field.key),
      });
    for (const field of unmapped)
      addOperationalMetric('opsknight_automation_unmapped_total', 1, {
        field_type: ['STRING', 'ENUM', 'NUMBER', 'BOOLEAN'].includes(field.type)
          ? field.type
          : 'STRING',
      });
    return;
  }
  await prisma.$transaction(tx => enqueueAutomationNotification(tx, job));
}
export type NotifyJob = Extract<z.infer<typeof jobSchema>, { task: 'AUTOMATION_NOTIFY' }>;
export async function enqueueAutomationNotification(tx: Prisma.TransactionClient, job: NotifyJob) {
  const incident = await tx.incident.findFirst({
    where: { id: job.incidentId, serviceId: job.serviceId },
    include: { service: { select: { name: true } } },
  });
  if (!incident) return;
  if (job.provider === 'TEAMS') {
    const destination = await tx.microsoftTeamsDestination.findFirst({
      where: { id: job.destinationId, serviceId: job.serviceId, enabled: true },
    });
    if (!destination) return;
    await enqueueMicrosoftTeamsDeliveryInTransaction(tx, {
      incidentId: incident.id,
      destinationId: destination.id,
      eventType: 'triggered',
      incidentUpdatedAt: incident.createdAt,
      escalationGeneration: 0,
    });
    return {
      provider: 'TEAMS',
      destinationId: destination.id,
      label: destination.channelName ?? 'Teams channel',
    };
  } else {
    const destination = await tx.slackDestination.findFirst({
      where: { id: job.destinationId, serviceId: job.serviceId, enabled: true },
    });
    if (!destination) return;
    await createCentralNotificationIntent(
      {
        category: 'INCIDENT',
        channel: 'SLACK',
        recipientType: 'SLACK_CHANNEL',
        recipientId: job.serviceId,
        recipientAddress: destination.channelId,
        incidentId: incident.id,
        templateKey: 'automation-slack',
        sourceType: 'AUTOMATION',
        sourceId: incident.id,
        eventKey: job.logicalKey,
        displayMessage: `Automation: ${incident.title}`,
        payload: {
          kind: 'SLACK_CHANNEL',
          channel: destination.channelId,
          incident: {
            id: incident.id,
            title: incident.title,
            status: incident.status,
            urgency: incident.urgency,
            serviceName: incident.service.name,
          },
          eventType: 'triggered',
          serviceId: job.serviceId,
          includeInteractiveButtons: true,
        },
      },
      tx
    );
    return {
      provider: 'SLACK',
      destinationId: destination.id,
      label: destination.channelName ?? 'Slack channel',
    };
  }
}

/** Initial mixed-version rollout must not emit tasks that old workers cannot handle.
 * Once history exists, retention remains active even with the global switch OFF. */
export async function scheduleAutomationRetention(
  store: Pick<
    Prisma.TransactionClient,
    'automationTrace' | 'automationContextObservation' | 'backgroundJob'
  >
) {
  const history =
    (await store.automationTrace.findFirst({ select: { id: true } })) ??
    (await store.automationContextObservation.findFirst({ select: { id: true } }));
  if (!history) return false;
  const id = `AUTOMATION_RETENTION:${new Date().toISOString().slice(0, 10)}`;
  await store.backgroundJob.upsert({
    where: { id },
    create: {
      id,
      type: 'SCHEDULED_TASK',
      scheduledAt: new Date(),
      maxAttempts: 3,
      payload: { task: 'AUTOMATION_RETENTION' },
    },
    update: {},
  });
  return true;
}
