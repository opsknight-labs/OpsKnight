import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { saveDraft, publishVersion } from '@/lib/automation/versioning';
import { emptySnapshot } from '@/lib/automation/contract';

const { backfillAutomationSourceClassification, pendingClassificationCount } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS deploy script
  require('../../scripts/backfill-automation-source-classification.cjs') as {
    backfillAutomationSourceClassification: (
      prisma: typeof db,
      options?: { batchSize?: number }
    ) => Promise<number>;
    pendingClassificationCount: (prisma: typeof db) => Promise<number>;
  };

async function seedHistoricalTraces(count: number) {
  const service = await db.service.create({ data: { name: 'Backfill service' } });
  const actor = await createTestUser({ role: 'ADMIN' });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: actor.id,
    snapshot: emptySnapshot,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  const captured = [];
  for (let index = 0; index < count; index += 1) {
    captured.push(
      await db.incident.create({ data: { serviceId: service.id, title: `old ${index}` } })
    );
  }
  const untouched = await db.incident.create({
    data: { serviceId: service.id, title: 'never evaluated' },
  });
  // Simulates rows written before the classification trigger existed.
  await db.$executeRawUnsafe(
    'ALTER TABLE "AutomationTrace" DISABLE TRIGGER automation_shadow_source_classification'
  );
  try {
    for (const incident of captured) {
      await db.automationTrace.create({
        data: {
          incidentId: incident.id,
          serviceId: service.id,
          versionId: version.id,
          mode: 'SHADOW',
          evaluationAt: new Date(),
          durationMs: 1,
          detail: {},
        },
      });
    }
  } finally {
    await db.$executeRawUnsafe(
      'ALTER TABLE "AutomationTrace" ENABLE TRIGGER automation_shadow_source_classification'
    );
  }
  return { captured, untouched };
}

describe('automation source classification backfill', () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 30_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  it('classifies only incidents with automation history, across batches, and is re-runnable', async () => {
    const { captured, untouched } = await seedHistoricalTraces(3);
    expect(await pendingClassificationCount(db)).toBe(3);

    expect(await backfillAutomationSourceClassification(db, { batchSize: 1 })).toBe(3);

    const rows = await db.incident.findMany({
      where: { id: { in: [...captured.map(incident => incident.id), untouched.id] } },
      select: { id: true, automationSourceRestricted: true },
    });
    expect(
      rows
        .filter(row => row.automationSourceRestricted)
        .map(row => row.id)
        .sort()
    ).toEqual(captured.map(incident => incident.id).sort());
    expect(rows.find(row => row.id === untouched.id)?.automationSourceRestricted).toBe(false);
    expect(await pendingClassificationCount(db)).toBe(0);
    expect(await backfillAutomationSourceClassification(db)).toBe(0);
  });
});
