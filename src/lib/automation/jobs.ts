import { getAutomationSettings } from './settings';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import { enqueueMicrosoftTeamsDelivery } from '@/lib/microsoft-teams/delivery';
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
    })
    .strict(),
  z.object({ task: z.literal('AUTOMATION_RETENTION') }).strict(),
]);
export async function processAutomationJob(payload: unknown) {
  const job = jobSchema.parse(payload);
  if (job.task === 'AUTOMATION_RETENTION') {
    const requested = (await getAutomationSettings()).automationTraceRetentionDays;
    const days = Number.isFinite(requested) ? Math.max(1, Math.min(3650, requested)) : 90;
    const before = new Date(Date.now() - days * 86400000);
    const traces = await prisma.automationTrace.findMany({
      where: { evaluationAt: { lt: before } },
      select: { id: true },
      take: 1000,
    });
    await prisma.automationTrace.deleteMany({ where: { id: { in: traces.map(t => t.id) } } });
    const observations = await prisma.automationContextObservation.findMany({
      where: { lastSeenAt: { lt: before } },
      select: { id: true },
      take: 1000,
    });
    await prisma.automationContextObservation.deleteMany({
      where: { id: { in: observations.map(o => o.id) } },
    });
    return;
  }
  if (job.task === 'AUTOMATION_OBSERVE') {
    // Idempotency lives in the transaction: a crash/retry cannot count observations twice.
    const recorded = await prisma.$transaction(async tx => {
      const logicalId = createHash('sha256').update(JSON.stringify(job)).digest('hex');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${logicalId}, 0))`;
      const receiptId = `AUTOMATION_OBSERVATION_RECEIPT:${logicalId}`;
      if (await tx.backgroundJob.findUnique({ where: { id: receiptId } })) return false;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-observations:${job.serviceId}`}, 0))`;
      const existing = await tx.automationContextObservation.findMany({
        where: { serviceId: job.serviceId },
        select: { integrationId: true, fieldKey: true, normalizedRawValueHash: true },
      });
      const identities = new Set(
        existing.map(row =>
          JSON.stringify([row.integrationId, row.fieldKey, row.normalizedRawValueHash])
        )
      );
      const cardinalities = new Map<string, number>();
      for (const row of existing) {
        const key = JSON.stringify([row.integrationId, row.fieldKey]);
        cardinalities.set(key, (cardinalities.get(key) ?? 0) + 1);
      }
      let remaining = Math.max(0, 5000 - existing.length);
      const candidates = new Map(
        job.observations.map(observed => {
          const hash = createHash('sha256').update(observed.value).digest('hex');
          return [JSON.stringify([observed.key, hash]), { ...observed, hash }] as const;
        })
      );
      const values: Prisma.Sql[] = [];
      for (const observed of candidates.values()) {
        const identity = JSON.stringify([job.integrationId, observed.key, observed.hash]);
        const field = JSON.stringify([job.integrationId, observed.key]);
        if (!identities.has(identity)) {
          if (!remaining || (cardinalities.get(field) ?? 0) >= 256) continue;
          remaining--;
          cardinalities.set(field, (cardinalities.get(field) ?? 0) + 1);
        }
        values.push(
          Prisma.sql`(${randomUUID()}, ${job.serviceId}, ${job.integrationId}, ${job.integrationType}, ${observed.key}, ${observed.path}, ${observed.type}, ${observed.hash}, ${observed.value}, ${observed.unmapped}, 1, NOW(), NOW())`
        );
      }
      if (values.length)
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO "AutomationContextObservation" (id, "serviceId", "integrationId", "integrationType", "fieldKey", "sourcePath", "fieldType", "normalizedRawValueHash", "rawValuePreview", unmapped, count, "firstSeenAt", "lastSeenAt") VALUES ${Prisma.join(values)}
        ON CONFLICT ("serviceId", "integrationId", "fieldKey", "normalizedRawValueHash") DO UPDATE SET count = "AutomationContextObservation".count + 1, "lastSeenAt" = NOW(), unmapped = EXCLUDED.unmapped
      `);
      await tx.backgroundJob.create({
        data: {
          id: receiptId,
          type: 'SCHEDULED_TASK',
          status: 'COMPLETED',
          scheduledAt: new Date(),
          completedAt: new Date(),
          payload: { task: 'AUTOMATION_OBSERVATION_RECEIPT' },
        },
      });
      return true;
    });
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
  const incident = await prisma.incident.findFirst({
    where: { id: job.incidentId, serviceId: job.serviceId },
    include: { service: { select: { name: true } } },
  });
  if (!incident) return;
  if (job.provider === 'TEAMS') {
    const destination = await prisma.microsoftTeamsDestination.findFirst({
      where: { id: job.destinationId, serviceId: job.serviceId, enabled: true },
    });
    if (!destination) return;
    await enqueueMicrosoftTeamsDelivery({
      incidentId: incident.id,
      destinationId: destination.id,
      eventType: 'triggered',
      incidentUpdatedAt: incident.createdAt,
      escalationGeneration: 0,
    });
  } else {
    const destination = await prisma.slackDestination.findFirst({
      where: { id: job.destinationId, serviceId: job.serviceId, enabled: true },
    });
    if (!destination) return;
    await createCentralNotificationIntent({
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
    });
  }
}
