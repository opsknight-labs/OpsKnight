import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppRole } from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { updateAiSettings } from '@/lib/intelligence/ai/settings';
import { sha256 } from '@/lib/intelligence/ai/digest';
import { recordExchange } from '@/lib/intelligence/conversations/store';
import { getConversationForActor } from '@/lib/intelligence/conversations/view';
import { updateSquireMemorySettings } from '@/lib/intelligence/memory/settings';
import { listFeedbackForReview, recordFeedback } from '@/lib/intelligence/assistant/feedback';
import { squireChartSchema, type SquireEvent } from '@/lib/intelligence/squire/contract';
import { metricsChart } from '@/lib/intelligence/squire/tools-observability';
import { withCharts } from '@/lib/intelligence/squire/chat';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

// Only the session is replaced; the actions, the feedback store and the database are real.
const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  const actors = await import('@/lib/authorization-actors');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never))
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      return user;
    },
    getCurrentAuthorizationActor: async () => {
      if (!session.user) throw new Error('signed out');
      return actors.resolveUserActor(session.user.id);
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  dismissFeedbackAction,
  feedbackEvalCaseAction,
  learnFromFeedbackAction,
  markFeedbackLearnedAction,
} from '@/app/(app)/settings/intelligence/ai/feedback/actions';
import { POST as postFeedback } from '@/app/api/intelligence/squire/feedback/route';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  session.user = null;
});

const actorOf = async (id: string) => {
  const actor = await resolveUserActor(id);
  if (!actor) throw new Error('actor');
  return actor;
};

async function historyOn(adminId: string) {
  const current = await db.aiSettings.findUnique({ where: { id: 'default' } });
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 100,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 1024,
      requestTimeoutMs: 10_000,
      allowedDataRegions: [],
      squireHistoryEnabled: true,
      squireHistoryRetentionDays: 90,
      expectedRevision: current?.revision ?? 0,
    },
    { actorId: adminId, source: 'UI' }
  );
}

/** A metrics tool result as `query_metrics` returns it after redaction. */
const metricsResult = (series: unknown[]) => ({
  connectionId: 'conn_1',
  connectionName: 'Prod Prometheus',
  backend: 'Prometheus',
  kind: 'metrics',
  query: 'pool_in_use',
  window: { start: '2026-11-23T10:00:00.000Z', end: '2026-11-23T11:00:00.000Z' },
  seriesCount: series.length,
  series,
  truncated: false,
});
const sample = (minute: number, value: number) => ({
  at: `2026-11-23T10:${String(minute).padStart(2, '0')}:00.000Z`,
  value,
});

describe('charts in answers', () => {
  it('draws a query_metrics result and nothing else', () => {
    const chart = metricsChart(
      'query_metrics',
      metricsResult([
        {
          labels: { pool: 'checkout-primary', owner: '[email]' },
          // Out of order and with a repeated timestamp: sorted, the later value wins.
          samples: [sample(30, 98), sample(0, 40), sample(15, 55), sample(15, 60)],
        },
        { labels: { pool: 'single' }, samples: [sample(0, 1)] },
      ])
    );
    expect(chart).toEqual({
      title: 'pool_in_use',
      series: [
        {
          name: 'pool=checkout-primary, owner=[email]',
          points: [
            { t: '2026-11-23T10:00:00.000Z', v: 40 },
            { t: '2026-11-23T10:15:00.000Z', v: 60 },
            { t: '2026-11-23T10:30:00.000Z', v: 98 },
          ],
        },
      ],
      source: { kind: 'observability', id: 'conn_1', label: 'Prod Prometheus' },
    });
    expect(metricsChart('search_logs', metricsResult([]))).toBeNull();
    expect(
      metricsChart('query_metrics', { error: 'The connection could not be reached.' })
    ).toBeNull();
    expect(
      metricsChart('query_metrics', metricsResult([{ labels: {}, samples: [sample(0, 1)] }]))
    ).toBeNull();
    // At most four series, each name clipped.
    const many = metricsChart(
      'query_metrics',
      metricsResult(
        Array.from({ length: 8 }, (_, index) => ({
          labels: { pod: `${'x'.repeat(200)}${index}` },
          samples: [sample(0, index), sample(1, index + 1)],
        }))
      )
    );
    expect(many?.series).toHaveLength(4);
    expect(many?.series[0].name.length).toBeLessThanOrEqual(80);
  });

  it('accepts only a bounded, strict chart', () => {
    const valid = {
      title: 'cpu',
      series: [{ name: 'a', points: [{ t: '2026-11-23T10:00:00.000Z', v: 1 }] }],
    };
    expect(squireChartSchema.safeParse(valid).success).toBe(true);
    expect(squireChartSchema.safeParse({ ...valid, html: '<b>' }).success).toBe(false);
    expect(
      squireChartSchema.safeParse({
        ...valid,
        series: [{ name: 'a', points: [{ t: '2026-11-23T10:00:00.000Z', v: Infinity }] }],
      }).success
    ).toBe(false);
    expect(
      squireChartSchema.safeParse({ ...valid, series: Array(5).fill(valid.series[0]) }).success
    ).toBe(false);
    expect(
      squireChartSchema.safeParse({
        ...valid,
        series: [
          {
            name: 'a',
            points: Array.from({ length: 201 }, (_, i) => ({
              t: new Date(Date.UTC(2026, 10, 23, 0, i)).toISOString(),
              v: i,
            })),
          },
        ],
      }).success
    ).toBe(false);
    expect(
      squireChartSchema.safeParse({
        ...valid,
        source: { kind: 'observability', id: 'c', href: '//evil.example' },
      }).success
    ).toBe(false);
  });

  it('sends each chart before the next event and saves the charts with the turn', async () => {
    const chart = squireChartSchema.parse({
      title: 'pool_in_use',
      series: [
        {
          name: 'pool',
          points: [
            { t: '2026-11-23T10:00:00.000Z', v: 40 },
            { t: '2026-11-23T10:01:00.000Z', v: 98 },
          ],
        },
      ],
    });
    const charts: (typeof chart)[] = [];
    async function* turn(): AsyncGenerator<SquireEvent> {
      yield { type: 'tool', label: 'Querying metrics' };
      charts.push(chart);
      yield { type: 'delta', text: 'Pool use jumped.' };
      yield { type: 'memory', turn: { mode: 'ai' } };
      yield { type: 'done' };
    }
    const events: SquireEvent[] = [];
    for await (const event of withCharts(charts, turn())) events.push(event);
    expect(events.map(event => event.type)).toEqual(['tool', 'chart', 'delta', 'memory', 'done']);
    expect(events.find(event => event.type === 'memory')).toMatchObject({
      turn: { charts: [chart] },
    });
  });

  it('keeps a chart in the saved conversation so a reopened answer shows it', async () => {
    const owner = await createTestUser({ role: 'RESPONDER' });
    await historyOn(owner.id);
    const chart = metricsChart(
      'query_metrics',
      metricsResult([{ labels: { pool: 'a' }, samples: [sample(0, 1), sample(5, 2)] }])
    )!;
    const id = await recordExchange({
      userId: owner.id,
      question: 'Graph the pool metrics',
      answer: 'Pool use doubled.',
      turn: { mode: 'ai', verified: false, charts: [chart] },
    });
    const reopened = await getConversationForActor(await actorOf(owner.id), id);
    expect(reopened?.messages[1].envelope?.charts).toEqual([chart]);
    // An older answer without charts still reads.
    const plain = await recordExchange({
      userId: owner.id,
      question: 'Hello',
      answer: 'Hi.',
      turn: { mode: 'ai' },
    });
    expect(
      (await getConversationForActor(await actorOf(owner.id), plain))?.messages[1].envelope?.charts
    ).toBeUndefined();
  });
});

async function feedbackWorld() {
  const teamA = await createTestTeam('Team A');
  const teamB = await createTestTeam('Team B');
  const serviceA = await createTestService('Checkout', teamA.id);
  const serviceB = await createTestService('Payroll', teamB.id);
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
  const admin = await createTestUser({ role: 'ADMIN' });
  const incidentA = await createTestIncident('Pool exhausted', serviceA.id, { teamId: teamA.id });
  const hidden = await createTestIncident('Payroll outage', serviceB.id, {
    teamId: teamB.id,
    visibility: 'PRIVATE',
  });
  return { teamA, serviceA, serviceB, member, admin, incidentA, hidden };
}

const post = (body: unknown) =>
  postFeedback(
    new NextRequest('http://localhost:3000/api/intelligence/squire/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(body),
    })
  );

describe('help Squire learn', () => {
  it('stores the reason, note and readable incident and service, re-checked on the server', async () => {
    const w = await feedbackWorld();
    session.user = { id: w.member.id, role: 'USER' };
    const response = await post({
      rating: 'DOWN',
      mode: 'ai',
      reason: 'wrong_facts',
      note: 'The pool limit is 200, not 100',
      question: 'Why is checkout slow?',
      incidentId: w.incidentA.id,
    });
    expect(response.status).toBe(201);
    // An incident the person cannot read is dropped, and so is its service.
    expect(
      (
        await post({
          rating: 'DOWN',
          mode: 'ai',
          reason: 'missed_point',
          incidentId: w.hidden.id,
          serviceId: w.serviceB.id,
        })
      ).status
    ).toBe(201);
    // Free text is bounded.
    expect((await post({ rating: 'DOWN', mode: 'ai', note: 'x'.repeat(301) })).status).toBe(400);
    const rows = await db.squireFeedback.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows[0]).toMatchObject({
      reason: 'wrong_facts: The pool limit is 200, not 100',
      incidentId: w.incidentA.id,
      serviceId: w.serviceA.id,
      questionHash: sha256('Why is checkout slow?'),
      reviewStatus: 'NEW',
    });
    expect(rows[1]).toMatchObject({ incidentId: null, reason: 'missed_point' });
    // The claimed service is kept only if this person may read it.
    const readable = await db.service.count({
      where: { AND: [{ id: w.serviceB.id }, serviceReadWhere(await actorOf(w.member.id))] },
    });
    expect(rows[1].serviceId).toBe(readable ? w.serviceB.id : null);
  });

  it('lets only intelligence administrators review, and audits every action', async () => {
    const w = await feedbackWorld();
    const member = await actorOf(w.member.id);
    const withIncident = await recordFeedback(
      w.member.id,
      { rating: 'DOWN', mode: 'ai', reason: 'wrong_facts', note: 'stale fact', question: 'q?' },
      member
    );
    await db.squireFeedback.update({
      where: { id: withIncident },
      data: { incidentId: w.incidentA.id, serviceId: w.serviceA.id },
    });
    const basic = await recordFeedback(w.member.id, {
      rating: 'DOWN',
      mode: 'basic',
      intent: 'ON_CALL',
      reason: 'too_long',
    });

    // A responder cannot use any of the actions.
    session.user = { id: w.member.id, role: 'USER' };
    for (const result of [
      await dismissFeedbackAction(basic),
      await feedbackEvalCaseAction(basic),
      await learnFromFeedbackAction(withIncident, 'Checkout pool limit is 200 connections.'),
      await markFeedbackLearnedAction(withIncident, 'learn_candidate'),
    ])
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/administrators/) });
    expect((await db.squireFeedback.findMany()).map(row => row.reviewStatus)).toEqual([
      'NEW',
      'NEW',
    ]);

    session.user = { id: w.admin.id, role: 'ADMIN' };
    const admin = await actorOf(w.admin.id);
    const listed = await listFeedbackForReview(admin, { status: 'NEW' });
    expect(listed).toHaveLength(2);
    expect(listed.find(row => row.id === withIncident)).toMatchObject({
      mode: 'ai',
      reason: 'wrong_facts: stale fact',
      service: { id: w.serviceA.id, name: w.serviceA.name },
      incident: { id: w.incidentA.id, title: 'Pool exhausted' },
    });
    expect(JSON.stringify(listed)).not.toContain(w.member.id);

    // Eval case: no question text without history; the digest instead.
    const evalCase = await feedbackEvalCaseAction(basic);
    expect(evalCase.ok).toBe(true);
    const parsed = JSON.parse((evalCase as { json: string }).json);
    expect(parsed).toMatchObject({ expectIntent: 'ON_CALL', onIncident: false });
    expect(parsed.question).toMatch(/^TODO/);

    // Learning needs the knowledge index, an incident and a valid fact; then it is a card to confirm.
    await updateSquireMemorySettings({ knowledgeEnabled: true, expectedRevision: 0 }, w.admin.id);
    expect(await learnFromFeedbackAction(basic, 'Checkout pool limit is 200 connections.')).toEqual(
      {
        ok: false,
        message: expect.stringMatching(/incident/),
      }
    );
    const learned = await learnFromFeedbackAction(
      withIncident,
      'Checkout pool limit is 200 connections.'
    );
    expect(learned).toMatchObject({
      ok: true,
      proposal: { action: 'learn_service_fact', kind: 'WRITE', incidentId: w.incidentA.id },
    });
    // Nothing is remembered until someone confirms the card, and the row stays NEW (and on screen) until then.
    expect(await db.knowledgeChunk.count({ where: { sourceKind: 'SERVICE_FACT' } })).toBe(0);
    expect((await db.squireFeedback.findMany()).map(row => row.reviewStatus)).toEqual([
      'NEW',
      'NEW',
    ]);
    // The page marks each row once its outcome happened: the card confirmed, the eval case shown.
    expect(await markFeedbackLearnedAction(withIncident, 'learn_candidate')).toMatchObject({
      ok: true,
    });
    expect(await markFeedbackLearnedAction(basic, 'eval_case')).toMatchObject({ ok: true });
    expect(
      await markFeedbackLearnedAction(basic, 'dismissed' as unknown as 'eval_case')
    ).toMatchObject({ ok: false });

    expect(await dismissFeedbackAction(basic)).toEqual({ ok: true, message: 'Dismissed.' });
    const statuses = Object.fromEntries(
      (await db.squireFeedback.findMany()).map(row => [row.id, row.reviewStatus])
    );
    expect(statuses).toEqual({ [withIncident]: 'LEARNED', [basic]: 'DISMISSED' });
    const audit = (await db.auditLog.findMany({ where: { actorId: w.admin.id } }))
      .map(entry => entry.action)
      .filter(action => action.startsWith('intelligence.squire.feedback.'))
      .sort();
    expect(audit).toEqual([
      'intelligence.squire.feedback.dismissed',
      'intelligence.squire.feedback.eval_case',
      'intelligence.squire.feedback.learn_candidate',
    ]);
  });

  it('never decrypts the rated question into an eval case, even while history is kept', async () => {
    const w = await feedbackWorld();
    await historyOn(w.admin.id);
    const conversationId = await recordExchange({
      userId: w.member.id,
      question: 'Who is on call for checkout?',
      answer: 'Alex is.',
    });
    const id = await recordFeedback(w.member.id, {
      rating: 'DOWN',
      mode: 'ai',
      reason: 'wrong_action',
      question: 'Who is on call for checkout?',
      conversationId,
    });
    session.user = { id: w.admin.id, role: 'ADMIN' };
    const result = await feedbackEvalCaseAction(id);
    const parsed = JSON.parse((result as { json: string }).json);
    expect(parsed).toMatchObject({ category: 'proposal-unwanted', expect: { mode: 'ai' } });
    // The reviewer may not be able to read what the question was about; only its digest is exported.
    expect(parsed.question).toMatch(/^TODO: the rated question \(sha256 [a-f0-9]{64}\)$/);
    expect((result as { json: string }).json).not.toContain('Who is on call for checkout?');
  });
});
