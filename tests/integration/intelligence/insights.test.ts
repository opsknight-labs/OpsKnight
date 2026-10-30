import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { DEFAULT_POLICY_DEFINITION } from '@/lib/intelligence/contract';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { getFeedbackCalibration, getInsights, getWeeklySummary } from '@/lib/intelligence/insights/service';
import { publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { createTestIncident, createTestService, createTestTeam, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never)) {
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      }
      return user;
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { applyMinScoreSuggestion } from '@/app/(app)/settings/intelligence/insights/actions';

const DAY = 86_400_000;
const initial = { message: '', ok: false };
const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
  session.user = null;
});

async function indexed(title: string, serviceId: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  const incident = await createTestIncident(title, serviceId, { createdAt: new Date(Date.now() - daysAgo * DAY), ...extra });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

describe('recurring problems', () => {
  it('finds repeated masked titles over several days, flags missing runbooks, and respects service visibility', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const mine = await createTestService('Mine', teamA.id);
    const theirs = await createTestService('Theirs', teamB.id);
    const covered = await createTestService('Covered');

    for (const days of [1, 2, 3, 5]) await indexed(`Disk full on host-${days}`, mine.id, days, { teamId: teamA.id });
    for (const days of [1, 2, 3]) await indexed(`Queue stuck on worker-${days}`, theirs.id, days, { teamId: teamB.id });
    for (const days of [1, 2, 4]) await indexed(`Cert expiry on svc-${days}`, covered.id, days);
    // Same day only, and too few: neither qualifies.
    for (let i = 0; i < 4; i += 1) await indexed(`Burst on node-${i}`, mine.id, 0.2);
    await indexed('One-off error', mine.id, 2);

    const runbook = await db.runbook.create({ data: { name: 'fix', slug: `fix-${Math.random().toString(36).slice(2, 8)}` } });
    await db.serviceAutomationRule.create({ data: { serviceId: covered.id, runbookId: runbook.id } });

    const adminView = await getInsights(await actorOf(admin.id));
    const byTemplate = new Map(adminView!.recurring.map(item => [item.template, item]));
    expect(byTemplate.get('disk full on host-<num>')).toMatchObject({ occurrences: 4, distinctDays: 4, hasRunbook: false });
    expect(byTemplate.get('queue stuck on worker-<num>')).toMatchObject({ occurrences: 3 });
    expect(byTemplate.get('cert expiry on svc-<num>')).toMatchObject({ hasRunbook: true });
    expect(adminView!.recurring.map(item => item.template)).not.toContain('one-off error');
    expect(adminView!.recurring.map(item => item.template).some(template => template.startsWith('burst'))).toBe(false);
    expect(adminView!.recurring[0].occurrences).toBeGreaterThanOrEqual(adminView!.recurring.at(-1)!.occurrences);
    expect(adminView!.recurring[0].latestIncidentId).toEqual(expect.any(String));
  });

  it('shows nothing to people without intelligence access, and only readable services to scoped ones', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const mine = await createTestService('Mine', teamA.id);
    const theirs = await createTestService('Theirs', teamB.id);
    for (const days of [1, 2, 3]) {
      await indexed(`Disk full on host-${days}`, mine.id, days, { teamId: teamA.id });
      await indexed(`Queue stuck on worker-${days}`, theirs.id, days, { teamId: teamB.id });
    }
    const user = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: user.id, teamId: teamA.id, role: 'MEMBER' } });
    expect(await getInsights(await actorOf(user.id))).toBeNull(); // USER has no intelligence.read

    const responder = await createTestUser({ role: 'RESPONDER' });
    const all = await getInsights(await actorOf(responder.id));
    expect(all!.recurring).toHaveLength(2);
    expect(all!.calibration).toBeNull(); // aggregate feedback is for managers only
  });
});

describe('unusual volume', () => {
  it('flags a surge against the service baseline and ignores steady services', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const surging = await createTestService('Surging');
    const steady = await createTestService('Steady');
    for (let week = 1; week <= 4; week += 1) {
      await createTestIncident(`old ${week}`, surging.id, { createdAt: new Date(Date.now() - (week * 7 + 1) * DAY) });
      for (let i = 0; i < 6; i += 1) await createTestIncident(`steady ${week}-${i}`, steady.id, { createdAt: new Date(Date.now() - (week * 7 + 1 + i * 0.1) * DAY) });
    }
    for (let i = 0; i < 12; i += 1) await createTestIncident(`new ${i}`, surging.id, { createdAt: new Date(Date.now() - (1 + i * 0.1) * DAY) });
    for (let i = 0; i < 6; i += 1) await createTestIncident(`steady now ${i}`, steady.id, { createdAt: new Date(Date.now() - (1 + i * 0.1) * DAY) });

    const view = await getInsights(await actorOf(admin.id));
    expect(view!.anomalies.map(item => item.serviceId)).toEqual([surging.id]);
    expect(view!.anomalies[0]).toMatchObject({ recent: 12, baselineWeekly: 1, ratio: 12 });
  });
});

describe('feedback calibration and applying a suggestion', () => {
  async function seedFeedback(admin: { id: string }) {
    const service = await createTestService('API');
    const incident = await createTestIncident('subject', service.id);
    const verdicts: Array<[number, 'HELPFUL' | 'NOT_HELPFUL', number]> = [
      [0.4, 'HELPFUL', 1], [0.4, 'NOT_HELPFUL', 14], [0.6, 'HELPFUL', 3], [0.6, 'NOT_HELPFUL', 8], [0.8, 'HELPFUL', 22], [0.8, 'NOT_HELPFUL', 2],
    ];
    let n = 0;
    for (const [score, verdict, count] of verdicts) {
      for (let i = 0; i < count; i += 1) {
        const finding = await db.intelligenceFinding.create({
          data: { incidentId: incident.id, kind: 'SIMILAR_INCIDENT', confidence: score, evidence: {}, generation: ++n, engineVersion: 't', subjectRef: 'x' },
        });
        await db.intelligenceFeedback.create({ data: { subjectType: 'FINDING', subjectId: finding.id, verdict, actorId: admin.id } });
      }
    }
  }

  it('summarises ratings by score and proposes a higher threshold', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await publishPolicyVersion({}, { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, { actorId: admin.id, source: 'UI' });
    await seedFeedback(admin);
    const calibration = await getFeedbackCalibration();
    expect(calibration).toMatchObject({ votes: 50, helpful: 26, currentMinScore: 0.35 });
    expect(calibration.buckets.map(bucket => bucket.from)).toEqual([0.4, 0.6, 0.8]);
    expect(calibration.suggestion).toMatchObject({ suggested: 0.65, votes: 24 });
    const view = await getInsights(await actorOf(admin.id));
    expect(view!.calibration?.suggestion?.suggested).toBe(0.65);
  });

  it('applies the suggestion only for managers, only when it still matches, as a new audited version', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await publishPolicyVersion({}, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, { actorId: admin.id, source: 'UI' });
    await seedFeedback(admin);
    const form = (suggested: number, head: number) => {
      const data = new FormData();
      data.set('suggested', String(suggested));
      data.set('expectedHeadVersion', String(head));
      return data;
    };

    session.user = { id: (await createTestUser({ role: 'RESPONDER' })).id, role: 'RESPONDER' };
    expect((await applyMinScoreSuggestion(initial, form(0.65, 1))).ok).toBe(false);
    expect((await resolveEffectivePolicy(null)).version).toBe(1);

    session.user = { id: admin.id, role: 'ADMIN' };
    const mismatch = await applyMinScoreSuggestion(initial, form(0.9, 1));
    expect(mismatch).toEqual({ ok: false, message: expect.stringMatching(/changed as new feedback/i) });
    const stale = await applyMinScoreSuggestion(initial, form(0.65, 0));
    expect(stale.ok).toBe(false);

    const applied = await applyMinScoreSuggestion(initial, form(0.65, 1));
    expect(applied).toMatchObject({ ok: true });
    const policy = await resolveEffectivePolicy(null);
    expect(policy).toMatchObject({ version: 2, mode: 'SHADOW' });
    expect(policy.definition.similarity.minScore).toBe(0.65);
    expect((await db.auditLog.findMany({ where: { action: 'intelligence.policy.published' } })).length).toBe(2);

    // Once applied the suggestion no longer exceeds the current threshold, so there is nothing to apply again.
    expect((await getFeedbackCalibration()).suggestion).toBeNull();
  });

  it('proposes nothing without feedback', async () => {
    const calibration = await getFeedbackCalibration();
    expect(calibration).toMatchObject({ votes: 0, helpful: 0, buckets: [], suggestion: null });
  });
});

describe('weekly summary', () => {
  it('counts only the last seven days, aggregates across services, and is for managers only', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('API');
    const a = await createTestIncident('a', service.id);
    const b = await createTestIncident('b', service.id);
    const mk = (incidentId: string, kind: 'SIMILAR_INCIDENT' | 'CHANGE_CORRELATION', createdAt: Date, generation: number) =>
      db.intelligenceFinding.create({ data: { incidentId, kind, confidence: 0.5, evidence: {}, generation, engineVersion: 't', createdAt } });
    const recent = new Date(Date.now() - DAY);
    const old = new Date(Date.now() - 20 * DAY);
    const f1 = await mk(a.id, 'SIMILAR_INCIDENT', recent, 1);
    await mk(a.id, 'CHANGE_CORRELATION', recent, 2);
    await mk(b.id, 'SIMILAR_INCIDENT', recent, 3);
    await mk(b.id, 'SIMILAR_INCIDENT', old, 4);
    await db.intelligenceFeedback.create({ data: { subjectType: 'FINDING', subjectId: f1.id, verdict: 'HELPFUL', actorId: admin.id, createdAt: recent } });
    await db.intelligenceFeedback.create({ data: { subjectType: 'FINDING', subjectId: f1.id, verdict: 'NOT_HELPFUL', createdAt: recent } });
    await db.intelligenceFeedback.create({ data: { subjectType: 'FINDING', subjectId: f1.id, verdict: 'NOT_HELPFUL', createdAt: old } });
    await db.changeEvent.create({ data: { serviceId: service.id, source: 'ci', kind: 'DEPLOY', summary: 'x', occurredAt: recent, createdAt: recent } });
    await db.intelligenceWorkItem.create({ data: { kind: 'INDEX_INCIDENT', subjectKey: 'dead', attempts: 8 } });

    const summary = await getWeeklySummary();
    expect(summary).toEqual({
      windowDays: 7,
      incidentsAnalyzed: 2,
      findingsByKind: { SIMILAR_INCIDENT: 2, CHANGE_CORRELATION: 1 },
      ratings: 2,
      helpfulRatings: 1,
      changesRecorded: 1,
      deadLetters: 1,
    });
    expect((await getInsights(await actorOf(admin.id)))!.weekly).toEqual(summary);
    const responder = await createTestUser({ role: 'RESPONDER' });
    expect((await getInsights(await actorOf(responder.id)))!.weekly).toBeNull();
  });

  it('is all zeros on an empty install', async () => {
    expect(await getWeeklySummary()).toMatchObject({ incidentsAnalyzed: 0, findingsByKind: {}, ratings: 0, changesRecorded: 0, deadLetters: 0 });
  });
});
