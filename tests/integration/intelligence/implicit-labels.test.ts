import { beforeEach, describe, expect, it } from 'vitest';
import { loadImplicitCauseLabels } from '@/lib/intelligence/learning/response-weights';
import { loadRunbookExamples } from '@/lib/intelligence/learning/runbook-weights';
import { IMPLICIT_LABEL_WEIGHT } from '@/lib/intelligence/learning/bounded-fit';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const HOUR = 3_600_000;
const changeEvidence = { kind: 'DEPLOY', relation: 'SAME_SERVICE', components: { proximity: 0.9 } };

async function changeFinding(incidentId: string, changeId: string) {
  return db.intelligenceFinding.create({
    data: {
      incidentId,
      kind: 'CHANGE_CORRELATION',
      subjectRef: changeId,
      evidence: changeEvidence,
      generation: 1,
      engineVersion: 'test',
    },
  });
}

describe('implicit cause labels', () => {
  it('labels the rolled-back deploy and a change named in the postmortem, never a judged one', async () => {
    const service = await createTestService('Checkout');
    const at = Date.now() - 4 * 24 * HOUR;
    const incident = await createTestIncident('Checkout errors', service.id, {
      createdAt: new Date(at),
    });
    const change = (summary: string, offset: number, extra: object = {}) =>
      db.changeEvent.create({
        data: {
          serviceId: service.id,
          source: 'test',
          kind: 'DEPLOY',
          summary,
          occurredAt: new Date(at + offset),
          ...extra,
        },
      });
    const older = await change('Deploy v1.1', -3 * HOUR, { version: 'v1.1' });
    const culprit = await change('Deploy v1.2', -HOUR, { version: 'v1.2' });
    await change('Rollback to v1.1', HOUR, { labels: { action: 'rollback' } });
    const rolledBack = await changeFinding(incident.id, culprit.id);
    const notLatest = await changeFinding(incident.id, older.id);

    // Second incident: no rollback, but its postmortem names the change; a judged finding is left alone.
    const other = await createTestIncident('Payments latency', service.id, {
      createdAt: new Date(at + 2 * 24 * HOUR),
    });
    const config = await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'test',
        kind: 'CONFIG',
        summary: 'Raise pool size to 400',
        occurredAt: new Date(at + 2 * 24 * HOUR - HOUR),
      },
    });
    await db.postmortem.create({
      data: {
        incidentId: other.id,
        title: 'PM',
        rootCause: 'The change "raise pool size to 400" exhausted DB connections.',
      },
    });
    const named = await changeFinding(other.id, config.id);
    const judgedIncident = await createTestIncident('Judged', service.id, {
      createdAt: new Date(at + HOUR / 2),
    });
    const judged = await changeFinding(judgedIncident.id, culprit.id);
    const user = await createTestUser();
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: judged.id,
        verdict: 'NOT_HELPFUL',
        actorId: user.id,
      },
    });

    const labels = await loadImplicitCauseLabels();
    const ids = labels.map(row => row.id).sort();
    expect(ids).toEqual([named.id, rolledBack.id].sort());
    expect(labels.every(row => row.helpful && row.implicit)).toBe(true);
    expect(ids).not.toContain(notLatest.id);
  });
});

describe('implicit runbook labels', () => {
  it('labels a recommended runbook the postmortem names, at lower weight', async () => {
    const service = await createTestService('Checkout');
    const runbook = await db.runbook.create({
      data: { name: 'Restart checkout pods', slug: 'restart-checkout-pods' },
    });
    const incident = await createTestIncident('Checkout down', service.id);
    await db.intelligenceFinding.create({
      data: {
        incidentId: incident.id,
        kind: 'RUNBOOK_RECOMMENDATION',
        subjectRef: runbook.id,
        evidence: { succeeded: 3, eligible: 4, bound: true },
        generation: 1,
        engineVersion: 'test',
      },
    });
    await db.postmortem.create({
      data: {
        incidentId: incident.id,
        title: 'PM',
        resolution: 'We ran Restart Checkout Pods and errors cleared.',
      },
    });
    expect(await loadRunbookExamples()).toEqual([
      {
        succeeded: 3,
        eligible: 4,
        bound: true,
        helpful: true,
        source: 'IMPLICIT',
        weight: IMPLICIT_LABEL_WEIGHT,
      },
    ]);
  });
});
