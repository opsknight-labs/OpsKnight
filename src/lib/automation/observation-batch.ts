/* eslint-disable security/detect-object-injection -- Rollup counter keys come from a fixed typed constant list. */
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import type { ObservationJob } from './jobs';

const receipt = (job: ObservationJob) =>
  `AUTOMATION_OBSERVATION_RECEIPT:${createHash('sha256').update(JSON.stringify(job)).digest('hex')}`;

/** Consume a bounded, durable service batch. Receipts, rollups and queue completion
 * commit together; other workers skip the locked pending rows. */
export async function persistObservationBatch(
  tx: Prisma.TransactionClient,
  current: ObservationJob,
  parse: (payload: unknown) => ObservationJob | null
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-observations:${current.serviceId}`}, 0))`;
  if (await tx.backgroundJob.findUnique({ where: { id: receipt(current) } })) return false;
  const pending = await tx.$queryRaw<Array<{ id: string; payload: Prisma.JsonValue }>>`
    SELECT id, payload FROM "BackgroundJob"
    WHERE type = 'SCHEDULED_TASK'::"JobType" AND status = 'PENDING'::"JobStatus"
      AND "scheduledAt" <= NOW() AND payload->>'task' = 'AUTOMATION_OBSERVE'
      AND payload->>'serviceId' = ${current.serviceId}
    ORDER BY "scheduledAt", id LIMIT 15 FOR UPDATE SKIP LOCKED`;
  const siblings = pending.flatMap(row => {
    const job = parse(row.payload);
    return job ? [{ id: row.id, job }] : [];
  });
  const candidates = [current, ...siblings.map(row => row.job)];
  const receipts = await tx.backgroundJob.findMany({
    where: { id: { in: candidates.map(receipt) } },
    select: { id: true },
  });
  const seen = new Set(receipts.map(row => row.id));
  const jobs = candidates.filter(job => {
    const id = receipt(job);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  let remaining = Math.max(
    0,
    5000 -
      (await tx.automationContextObservation.count({ where: { serviceId: current.serviceId } }))
  );
  const integrations = new Map<string, ObservationJob[]>();
  for (const job of jobs)
    integrations.set(job.integrationId, [...(integrations.get(job.integrationId) ?? []), job]);
  for (const [integrationId, group] of integrations) {
    const observations = new Map<
      string,
      ObservationJob['observations'][number] & {
        hash: string;
        count: number;
        integrationType: string;
      }
    >();
    for (const job of group) {
      const eventIdentities = new Set<string>();
      for (const observed of job.observations) {
        const hash = createHash('sha256').update(observed.value).digest('hex');
        const identity = JSON.stringify([observed.key, hash]);
        if (eventIdentities.has(identity)) continue;
        eventIdentities.add(identity);
        const prior = observations.get(identity);
        observations.set(identity, {
          ...observed,
          hash,
          count: (prior?.count ?? 0) + 1,
          integrationType: job.integrationType,
        });
      }
    }
    if (!observations.size) continue;
    const fields = [...new Set([...observations.values()].map(o => o.key))];
    const hashes = [...new Set([...observations.values()].map(o => o.hash))];
    const [existing, totals] = await Promise.all([
      tx.automationContextObservation.findMany({
        where: {
          serviceId: current.serviceId,
          integrationId,
          fieldKey: { in: fields },
          normalizedRawValueHash: { in: hashes },
        },
        select: { fieldKey: true, normalizedRawValueHash: true },
      }),
      tx.automationContextObservation.groupBy({
        by: ['fieldKey'],
        where: { serviceId: current.serviceId, integrationId, fieldKey: { in: fields } },
        _count: { _all: true },
      }),
    ]);
    const identities = new Set(
      existing.map(row => JSON.stringify([row.fieldKey, row.normalizedRawValueHash]))
    );
    const cardinalities = new Map(totals.map(row => [row.fieldKey, row._count._all]));
    const values: Prisma.Sql[] = [];
    for (const [identity, observed] of observations) {
      if (!identities.has(identity)) {
        if (!remaining || (cardinalities.get(observed.key) ?? 0) >= 256) continue;
        remaining--;
        cardinalities.set(observed.key, (cardinalities.get(observed.key) ?? 0) + 1);
      }
      values.push(
        Prisma.sql`(${randomUUID()}, ${current.serviceId}, ${integrationId}, ${observed.integrationType}, ${observed.key}, ${observed.path}, ${observed.type}, ${observed.hash}, ${observed.value}, ${observed.unmapped}, ${observed.count}, NOW(), NOW())`
      );
    }
    if (values.length)
      await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AutomationContextObservation" (id, "serviceId", "integrationId", "integrationType", "fieldKey", "sourcePath", "fieldType", "normalizedRawValueHash", "rawValuePreview", unmapped, count, "firstSeenAt", "lastSeenAt") VALUES ${Prisma.join(values)}
      ON CONFLICT ("serviceId", "integrationId", "fieldKey", "normalizedRawValueHash") DO UPDATE SET count = "AutomationContextObservation".count + EXCLUDED.count, "lastSeenAt" = NOW(), unmapped = EXCLUDED.unmapped`);
  }
  const rollups = new Map<string, NonNullable<ObservationJob['shadow']>>();
  for (const job of jobs) {
    if (!job.shadow) continue;
    const key = JSON.stringify([job.shadow.versionId, job.shadow.bucketDate]);
    const previous = rollups.get(key);
    const next = { ...job.shadow };
    if (previous)
      for (const field of [
        'evaluated',
        'same',
        'priorityDifferent',
        'routeDifferent',
        'noEscalationDifferent',
        'errors',
        'fallbacks',
      ] as const)
        next[field] += previous[field];
    rollups.set(key, next);
  }
  for (const rollup of rollups.values()) {
    const { versionId, bucketDate, ...counts } = rollup;
    const bucket = new Date(bucketDate);
    await tx.automationShadowAggregate.upsert({
      where: {
        serviceId_versionId_bucketDate: {
          serviceId: current.serviceId,
          versionId,
          bucketDate: bucket,
        },
      },
      create: { serviceId: current.serviceId, versionId, bucketDate: bucket, ...counts },
      update: Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [key, { increment: value }])
      ),
    });
  }
  await tx.backgroundJob.createMany({
    data: jobs.map(job => ({
      id: receipt(job),
      type: 'SCHEDULED_TASK',
      status: 'COMPLETED',
      scheduledAt: new Date(),
      completedAt: new Date(),
      payload: { task: 'AUTOMATION_OBSERVATION_RECEIPT' },
    })),
    skipDuplicates: true,
  });
  if (siblings.length)
    await tx.backgroundJob.updateMany({
      where: { id: { in: siblings.map(row => row.id) }, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  return true;
}
