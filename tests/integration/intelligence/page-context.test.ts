import { beforeEach, describe, expect, it } from 'vitest';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { replaceFindings } from '@/lib/intelligence/similarity/findings';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const switches = (pageContextEnabled: boolean) =>
  db.intelligenceSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, pageContextEnabled },
    update: { pageContextEnabled },
  });

const row = (subjectRef: string, confidence: number) => ({
  confidence,
  subjectRef,
  evidence: { type: 'test' },
});

async function write(
  incidentId: string,
  kind: 'SIMILAR_INCIDENT' | 'CHANGE_CORRELATION' | 'RUNBOOK_RECOMMENDATION' | 'PROBABLE_CAUSE',
  generation: number,
  rows: ReturnType<typeof row>[]
) {
  return db.$transaction(tx =>
    replaceFindings(tx, { incidentId, kind, generation, policyVersion: null, rows })
  );
}

const stored = async (id: string) =>
  await db.incident.findUniqueOrThrow({
    where: { id },
    select: { pageContext: true, updatedAt: true },
  });

describe('page context precomputed from findings', () => {
  it('keeps the rank-1 lead of each page kind on the incident row, without moving updatedAt', async () => {
    await switches(true);
    const service = await createTestService('Api');
    const incident = await createTestIncident('api down', service.id);
    const before = (await stored(incident.id)).updatedAt;

    await write(incident.id, 'SIMILAR_INCIDENT', 1, [row('inc_a', 0.9), row('inc_b', 0.5)]);
    await write(incident.id, 'CHANGE_CORRELATION', 1, [row('chg_1', 0.7)]);
    await write(incident.id, 'RUNBOOK_RECOMMENDATION', 1, [row('rb_1', 0.6)]);
    await write(incident.id, 'PROBABLE_CAUSE', 1, [row('inc_up', 0.8)]);

    const after = await stored(incident.id);
    expect(after.pageContext).toEqual({
      similarIncidentId: 'inc_a',
      changeId: 'chg_1',
      runbookId: 'rb_1',
    });
    expect(after.updatedAt).toEqual(before);

    // A newer run that finds no change drops that lead; an empty set clears the column.
    await write(incident.id, 'CHANGE_CORRELATION', 2, []);
    expect((await stored(incident.id)).pageContext).toEqual({
      similarIncidentId: 'inc_a',
      runbookId: 'rb_1',
    });
    await write(incident.id, 'SIMILAR_INCIDENT', 2, []);
    await write(incident.id, 'RUNBOOK_RECOMMENDATION', 2, []);
    expect((await stored(incident.id)).pageContext).toBeNull();
  });

  it('writes nothing while the switch is off and clears a stale context on the next write', async () => {
    await switches(false);
    const service = await createTestService('Api');
    const incident = await createTestIncident('api down', service.id, {
      pageContext: { changeId: 'chg_old' },
    });

    await write(incident.id, 'CHANGE_CORRELATION', 1, [row('chg_1', 0.7)]);

    expect((await stored(incident.id)).pageContext).toBeNull();
  });
});
