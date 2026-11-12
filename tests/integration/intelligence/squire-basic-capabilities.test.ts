import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  createTestOnCallSchedule,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';
import { resolveUserActor } from '@/lib/authorization-actors';
import { AI_SETTINGS_DEFAULTS } from '@/lib/intelligence/ai/contract';
import { updateAiSettings } from '@/lib/intelligence/ai/settings';
import { invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { answerDeterministically } from '@/lib/intelligence/squire/deterministic';
import { getConversationForActor } from '@/lib/intelligence/conversations/view';
import { recordExchange } from '@/lib/intelligence/conversations/store';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  invalidateGatewayCache();
});
async function world() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const team = await createTestTeam('Payments');
  const hiddenTeam = await createTestTeam('Private');
  const user = await createTestUser({ role: 'USER', timeZone: 'Asia/Kolkata', name: 'Responder' });
  await db.teamMember.create({ data: { userId: user.id, teamId: team.id, role: 'MEMBER' } });
  const checkout = await createTestService('Checkout API', team.id);
  const payroll = await createTestService('Secret Payroll', hiddenTeam.id);
  const own = await createTestIncident('Checkout connection errors', checkout.id, {
    assigneeId: user.id,
    urgency: 'HIGH',
    priority: 'P1',
  });
  const other = await createTestIncident('Secret payroll incident', payroll.id, {
    teamId: hiddenTeam.id,
  });
  const unassigned = await createTestIncident('Checkout unassigned latency', checkout.id, {
    urgency: 'LOW',
  });
  await updateAiSettings(
    {
      ...AI_SETTINGS_DEFAULTS,
      enabled: false,
      squireEnabled: true,
      squireHistoryEnabled: true,
      expectedRevision: 0,
    },
    { actorId: admin.id, source: 'UI' }
  );
  const actor = (await resolveUserActor(user.id))!;
  return { admin, actor, team, hiddenTeam, user, checkout, payroll, own, other, unassigned };
}
async function ask(
  actor: NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>,
  message: string,
  incidentId?: string
) {
  const events: SquireEvent[] = [];
  for await (const event of streamSquire(actor, {
    message,
    history: [],
    ...(incidentId ? { incidentId } : {}),
  }))
    events.push(event);
  expect(events.some(event => event.type === 'error')).toBe(false);
  expect(events).toContainEqual(expect.objectContaining({ type: 'meta', mode: 'basic' }));
  const text = events
    .filter((e): e is Extract<SquireEvent, { type: 'delta' }> => e.type === 'delta')
    .map(e => e.text)
    .join('');
  const citations = events.flatMap(e => (e.type === 'citations' ? e.items : []));
  return { text, citations, events };
}

describe('non-AI operational questions', () => {
  it('filters personal work, priority and urgency while keeping private team data out', async () => {
    const w = await world();
    const result = await ask(w.actor, 'Show my high urgency P1 open checkout incidents');
    expect(result.text).toContain('1 match');
    expect(result.text).toContain(w.own.title);
    expect(result.text).not.toContain(w.other.title);
    expect(result.text).not.toContain(w.unassigned.title);
    expect(result.citations).toContainEqual(
      expect.objectContaining({ id: w.own.id, kind: 'incident' })
    );
    const team = await ask(w.actor, 'Show my team unassigned incidents');
    expect(team.text).toContain(w.unassigned.title);
    expect(team.text).not.toContain(w.own.title);
  });
  it('calculates scoped incident counts and distinguishes alerts from incidents', async () => {
    const w = await world();
    await db.alert.createMany({
      data: [
        { incidentId: w.own.id, serviceId: w.checkout.id, payload: {}, status: 'TRIGGERED' },
        { incidentId: w.own.id, serviceId: w.checkout.id, payload: {}, status: 'TRIGGERED' },
        { incidentId: w.other.id, serviceId: w.payroll.id, payload: {}, status: 'TRIGGERED' },
        { serviceId: w.checkout.id, payload: {}, status: 'TRIGGERED' },
      ],
    });
    const report = await ask(w.actor, 'How many incidents today?');
    expect(report.text).toContain('**2 incidents created**');
    expect(report.text).not.toMatch(/Secret|Payroll/);
    const alerts = await ask(w.actor, 'How many alerts today?');
    expect(alerts.text).toContain('**2 alert records**');
    expect(alerts.citations).toHaveLength(2);
  });
  it('reports resolution time from actual resolution dates without claiming SLA performance', async () => {
    const w = await world();
    const now = Date.now();
    await db.incident.update({
      where: { id: w.own.id },
      data: {
        status: 'RESOLVED',
        createdAt: new Date(now - 20 * 86400000),
        resolvedAt: new Date(now - 3600000),
      },
    });
    const result = await ask(w.actor, 'How many incidents resolved today?');
    expect(result.text).toContain('**1 incident resolved**');
    expect(result.text).toContain('not SLA paused time');
    expect(result.text).toContain('across 1 valid resolved incidents');
  });
  it('reads service ownership, active incidents and only visible dependency edges', async () => {
    const w = await world();
    await db.serviceDependency.create({
      data: {
        downstreamServiceId: w.checkout.id,
        upstreamServiceId: w.payroll.id,
        origin: 'DECLARED',
        evidence: {},
        status: 'ACTIVE',
      },
    });
    const result = await ask(w.actor, `Who owns "${w.checkout.name}"?`);
    expect(result.text).toContain(w.team.name);
    expect(result.text).toContain(w.own.title);
    expect(result.text).not.toMatch(/Secret|Payroll/);
    expect(result.citations).toContainEqual(
      expect.objectContaining({
        kind: 'service',
        id: w.checkout.id,
        href: `/services/${w.checkout.id}`,
      })
    );
  });
  it('asks for clarification for ambiguous services and never substitutes hidden ones', async () => {
    const w = await world();
    await createTestService('Checkout Worker', w.team.id);
    expect((await ask(w.actor, 'Who owns Checkout?')).text).toContain('Several services match');
    const hidden = await ask(w.actor, `Who owns "${w.payroll.name}"?`);
    expect(hidden.text).toContain('No matching service');
    expect(hidden.text).not.toContain(w.payroll.name);
  });
  it('searches only readable non-archived runbooks and returns actual catalog counts', async () => {
    const w = await world();
    const runbook = await db.runbook.create({
      data: {
        name: 'Database pool recovery',
        slug: 'database-pool-recovery',
        ownerTeamId: w.team.id,
        description: 'Check the pool',
        tags: ['database'],
      },
    });
    await db.serviceAutomationRule.create({
      data: { serviceId: w.checkout.id, runbookId: runbook.id },
    });
    await db.runbook.create({
      data: {
        name: 'Secret database procedure',
        slug: 'secret-database',
        ownerTeamId: w.hiddenTeam.id,
      },
    });
    await db.runbook.create({
      data: {
        name: 'Database old playbook',
        slug: 'database-old',
        ownerTeamId: w.team.id,
        archivedAt: new Date(),
      },
    });
    const denied = await ask(w.actor, 'Find database runbooks');
    expect(denied.text).toContain('do not have permission');
    expect(denied.text).not.toMatch(/Database pool|Secret/);
    const result = await ask(
      (await resolveUserActor(w.admin.id))!,
      'Find "Database pool recovery" runbooks'
    );
    expect(result.text).toContain('1 matching non-archived runbooks');
    expect(result.text).not.toMatch(/Secret|old playbook/);
    expect(result.citations).toContainEqual(
      expect.objectContaining({ kind: 'runbook', id: runbook.id })
    );
  });
  it('queries recorded deployments with service filters without inventing root causes', async () => {
    const w = await world();
    await db.changeEvent.createMany({
      data: [
        {
          serviceId: w.checkout.id,
          kind: 'DEPLOY',
          source: 'test',
          summary: 'Checkout release 42',
          occurredAt: new Date(),
        },
        {
          serviceId: w.payroll.id,
          kind: 'DEPLOY',
          source: 'test',
          summary: 'Secret release',
          occurredAt: new Date(),
        },
        {
          serviceId: w.checkout.id,
          kind: 'CONFIG',
          source: 'test',
          summary: 'Checkout config',
          occurredAt: new Date(),
        },
      ],
    });
    const result = await ask(w.actor, 'Recent deployments for Checkout');
    expect(result.text).toContain('Checkout release 42');
    expect(result.text).not.toMatch(/Secret|Checkout config/);
    expect(result.text).toContain('timing alone does not establish a root cause');
  });
  it('lists overdue tasks and postmortems using incident authorization', async () => {
    const w = await world();
    const pm = await db.postmortem.create({
      data: {
        incidentId: w.own.id,
        title: 'Checkout review',
        rootCause: 'Pool limit too small',
        status: 'DRAFT',
      },
    });
    await db.postmortem.create({ data: { incidentId: w.other.id, title: 'Secret postmortem' } });
    await db.actionItem.create({
      data: {
        incidentId: w.own.id,
        postmortemId: pm.id,
        title: 'Increase pool visibility',
        ownerId: w.user.id,
        dueDate: new Date(Date.now() - 86400000),
      },
    });
    await db.actionItem.create({
      data: {
        incidentId: w.own.id,
        postmortemId: pm.id,
        title: 'Completed task',
        dueDate: new Date(Date.now() - 86400000),
        status: 'COMPLETED',
      },
    });
    const work = await ask(w.actor, 'Show my overdue action items');
    expect(work.text).toContain('Increase pool visibility');
    expect(work.text).not.toContain('Completed task');
    const reviews = await ask(w.actor, 'Find checkout postmortems');
    expect(reviews.text).toContain('Pool limit too small');
    expect(reviews.text).not.toContain('Secret postmortem');
    expect(reviews.citations).toContainEqual(
      expect.objectContaining({ kind: 'postmortem', href: `/postmortems/${w.own.id}` })
    );
  });
  it('never uses unrelated schedules when a service has no schedule target', async () => {
    const w = await world();
    await createTestOnCallSchedule('Unrelated schedule', [
      { start: new Date(Date.now() - 3600000), userIds: [w.user.id] },
    ]);
    const result = await ask(w.actor, `Who is on call for "${w.checkout.name}"?`);
    expect(result.text).toContain('not substituted unrelated schedules');
    expect(result.text).not.toContain('Unrelated schedule');
  });
  it('resolves named-service coverage using real rotation math and excludes invisible schedules', async () => {
    const w = await world();
    const schedule = await createTestOnCallSchedule('Checkout coverage', [
      { start: new Date(Date.now() - 3600000), userIds: [w.user.id] },
    ]);
    const policy = await db.escalationPolicy.create({
      data: {
        name: 'Checkout escalation',
        steps: {
          create: {
            stepOrder: 0,
            delayMinutes: 0,
            targetScheduleId: schedule.id,
            targetType: 'SCHEDULE',
          },
        },
      },
    });
    await db.service.update({
      where: { id: w.checkout.id },
      data: { escalationPolicyId: policy.id },
    });
    const result = await ask(w.actor, `Who is on call for "${w.checkout.name}" tomorrow?`);
    expect(result.text).toContain(w.user.name!);
    expect(result.text).toContain('point-in-time lookup');
    expect(result.citations).toContainEqual(
      expect.objectContaining({ kind: 'schedule', id: schedule.id })
    );
  });
  it('keeps saved service answers readable only while that service remains in scope', async () => {
    const w = await world();
    const result = await ask(w.actor, `Who owns "${w.checkout.name}"?`);
    const memory = result.events.find(
      (e): e is Extract<SquireEvent, { type: 'memory' }> => e.type === 'memory'
    )!;
    const id = await recordExchange({
      userId: w.user.id,
      question: 'Who owns Checkout?',
      answer: result.text,
      turn: { ...memory.turn, citations: result.citations },
    });
    expect((await getConversationForActor(w.actor, id))?.messages.at(-1)?.content).toContain(
      w.checkout.name
    );
    await db.service.update({ where: { id: w.checkout.id }, data: { teamId: w.hiddenTeam.id } });
    expect((await getConversationForActor(w.actor, id))?.messages.at(-1)?.content).not.toContain(
      w.checkout.name
    );
  });
  it('reuses prior question filters for follow-ups but never trusts prior assistant text', async () => {
    const w = await world();
    const answer = await answerDeterministically(w.actor, 'And low urgency?', null, undefined, {
      previousQuestions: ['Show open checkout incidents today'],
    });
    expect(answer).toContain(w.unassigned.title);
    expect(answer).not.toContain(w.own.title);
    const guidance = await ask(w.actor, 'How do schedule overrides work?');
    expect(guidance.text).toContain('temporary coverage change');
    expect(await db.aiProvider.count()).toBe(0);
    expect(await db.aiUsageDay.count()).toBe(0);
  });
});
