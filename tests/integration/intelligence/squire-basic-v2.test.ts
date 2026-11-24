import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  mentionedIncident,
  planBasicTurn,
  resolvePageContext,
} from '@/lib/intelligence/squire/deterministic';
import {
  confidentMatch,
  resetEntityCache,
  resolveEntities,
} from '@/lib/intelligence/squire/basic/entities';
import {
  pendingState,
  readDialogueState,
  resetDialogueMemory,
} from '@/lib/intelligence/assistant/dialogue-state';
import { resetBasicReadCaches } from '@/lib/intelligence/squire/basic/reads';
import {
  checksFor,
  deleteCheckTemplate,
  listCheckTemplates,
  resetCheckTemplateCache,
  saveCheckTemplate,
} from '@/lib/intelligence/assistant/check-templates';
import { getFeedbackSummary, recordFeedback } from '@/lib/intelligence/assistant/feedback';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { recordExchange } from '@/lib/intelligence/conversations/store';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  await resetDialogueMemory();
  resetEntityCache();
  resetBasicReadCaches();
  resetCheckTemplateCache();
});

async function world() {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
  const team = await createTestTeam('Checkout');
  // A team-scoped user, so visibility rules are really exercised (responders read everything).
  const responder = await createTestUser({ role: 'USER', name: 'Eval Responder' });
  await db.teamMember.create({ data: { userId: responder.id, teamId: team.id, role: 'MEMBER' } });
  // Exact names: the helper's random suffix would defeat name matching.
  const checkout = await createTestService('Checkout API', team.id, { name: 'Checkout API' });
  const payments = await createTestService('Payments Worker', team.id, { name: 'Payments Worker' });
  const paymentsApi = await createTestService('Payments API', team.id, { name: 'Payments API' });
  const incidents = await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      createTestIncident(`Pool exhausted ${i + 1}`, checkout.id, { assigneeId: responder.id })
    )
  );
  const actor = (await resolveUserActor(responder.id))!;
  return { admin, team, responder, checkout, payments, paymentsApi, incidents, actor };
}

async function collect(events: AsyncGenerator<SquireEvent>) {
  const out: SquireEvent[] = [];
  for await (const event of events) out.push(event);
  const text = out
    .filter(e => e.type === 'delta')
    .map(e => (e as { text: string }).text)
    .join('');
  const meta = out.find(e => e.type === 'meta') as
    Extract<SquireEvent, { type: 'meta' }> | undefined;
  const proposals = out.filter(e => e.type === 'proposal') as Array<
    Extract<SquireEvent, { type: 'proposal' }>
  >;
  const suggestions =
    (out.find(e => e.type === 'suggestions') as { items?: string[] } | undefined)?.items ?? [];
  return { out, text, meta, proposals, suggestions };
}

describe('an incident named by id or link', () => {
  it('recognises "incident <id>", a pasted link and a bare id, and keeps the rest of the question', () => {
    const id = 'cmwrxgqb503diocekj3xjhdwv';
    expect(mentionedIncident(`What's going on with incident ${id}`)).toEqual({
      id,
      rest: "What's going on with",
    });
    expect(mentionedIncident(`timeline of https://ops.example.com/incidents/${id}?x=1`)?.id).toBe(
      id
    );
    expect(mentionedIncident(`${id} its incident id from its url`)).toEqual({ id, rest: '' });
    expect(mentionedIncident('who is on call for checkout')).toBeNull();
  });

  it('answers about the named incident off its page, and never searches for the id as a keyword', async () => {
    const w = await world();
    await db.aiSettings.create({ data: { id: 'default', enabled: false, squireEnabled: true } });
    const target = w.incidents[2];
    for (const message of [
      `What's going on with incident ${target.id}`,
      `${target.id} its incident id from its url`,
      `/incidents/${target.id}`,
    ]) {
      const turn = await planBasicTurn({ actor: w.actor, message, incident: null });
      expect(turn.intent, message).toBe('INCIDENT_SUMMARY');
      expect(turn.text, message).toContain(target.title);
      expect(turn.text, message).not.toContain('0 matches');
    }
    const timeline = await planBasicTurn({
      actor: w.actor,
      message: `timeline for incident ${target.id}`,
      incident: null,
    });
    expect(timeline.intent).toBe('TIMELINE');
  });

  it('says it cannot find an incident the person may not open', async () => {
    const w = await world();
    await db.aiSettings.create({ data: { id: 'default', enabled: false, squireEnabled: true } });
    const outsiders = await createTestTeam('Outsiders');
    const hiddenService = await createTestService('Hidden Payroll', outsiders.id);
    const hidden = await createTestIncident('Payroll secret outage', hiddenService.id, {
      teamId: outsiders.id,
    });
    const turn = await planBasicTurn({
      actor: w.actor,
      message: `What's going on with incident ${hidden.id}`,
      incident: null,
    });
    expect(turn.text).toContain('can’t find that incident');
    expect(turn.text).not.toContain('Payroll secret');
  });
});

describe('fuzzy names', () => {
  it('matches a misspelt service to the closest visible one and never a hidden one', async () => {
    const w = await world();
    const outsider = await createTestTeam('Outsiders');
    await createTestService('Hidden Payroll', outsider.id, { name: 'Hidden Payroll' });
    await db.aiSettings.create({ data: { id: 'default', enabled: false, squireEnabled: true } });
    const matches = await resolveEntities(w.actor, 'chekout api', ['service']);
    expect(confidentMatch(matches, 'service')?.name).toBe('Checkout API');
    expect(
      (await resolveEntities(w.actor, 'hiden payrol', ['service'])).map(m => m.name)
    ).not.toContain('Hidden Payroll');
    const turn = await planBasicTurn({
      actor: w.actor,
      message: 'who owns chekout api',
      incident: null,
    });
    expect(turn.intent).toBe('SERVICE_HEALTH');
    expect(turn.text).toContain('Showing results for Checkout API');
    expect(turn.text).toContain('Owning team');
  });

  it('asks which service is meant when several are plausible, then completes the question from the reply', async () => {
    const w = await world();
    const first = await planBasicTurn({ actor: w.actor, message: 'who owns pay', incident: null });
    expect(first.text).toContain('Several services match');
    expect(first.nextState?.pending?.kind).toBe('service');
    expect(first.suggestions).toEqual(expect.arrayContaining(['Payments Worker', 'Payments API']));
    const second = await planBasicTurn({
      actor: w.actor,
      message: 'Payments Worker',
      incident: null,
      state: first.nextState,
    });
    expect(second.intent).toBe('SERVICE_HEALTH');
    expect(second.text).toContain('## Payments Worker');
    expect(second.nextState?.pending).toBeUndefined();
  });
});

describe('paging and breakdowns', () => {
  it('pages a list with "show more" and keeps the page cursor in the dialogue state', async () => {
    const w = await world();
    const first = await planBasicTurn({
      actor: w.actor,
      message: 'list open incidents',
      incident: null,
    });
    expect(first.text).toContain('7 matches');
    expect(first.text).toContain('Showing 1–5 of 7');
    expect(first.suggestions[0]).toBe('Show more');
    expect(first.nextState?.page).toMatchObject({ offset: 0, total: 7 });
    const second = await planBasicTurn({
      actor: w.actor,
      message: 'show more',
      incident: null,
      state: first.nextState,
    });
    expect(second.text).toContain('Showing 6–7 of 7');
    expect(second.nextState?.page).toBeUndefined();
    const nothing = await planBasicTurn({
      actor: w.actor,
      message: 'show more',
      incident: null,
      state: null,
    });
    expect(nothing.text).toContain('no list to continue');
  });

  it('breaks reports down by team, urgency and day, and reports MTTA', async () => {
    const w = await world();
    await db.incident.update({
      where: { id: w.incidents[0].id },
      data: {
        acknowledgedAt: new Date(w.incidents[0].createdAt.getTime() + 120_000),
        status: 'ACKNOWLEDGED',
      },
    });
    const byTeam = await planBasicTurn({
      actor: w.actor,
      message: 'incidents by team this week',
      incident: null,
    });
    expect(byTeam.intent).toBe('INCIDENT_STATS');
    expect(byTeam.text).toContain('### By team');
    expect(byTeam.text).toContain('Mean time to acknowledge: **2.0 minutes**');
    const byUrgency = await planBasicTurn({
      actor: w.actor,
      message: 'breakdown of incidents by urgency this week',
      incident: null,
    });
    expect(byUrgency.text).toContain('### By urgency');
    expect(byUrgency.text).toContain('high: 7');
    const byDay = await planBasicTurn({
      actor: w.actor,
      message: 'incidents per day this week',
      incident: null,
    });
    expect(byDay.text).toContain('### By day');
    expect(byDay.suggestions).toContain('Break it down by team');
  });

  it('filters by a named team and a named person', async () => {
    const w = await world();
    const other = await createTestUser({ role: 'RESPONDER', name: 'Someone Else' });
    await createTestIncident('Other person incident', w.checkout.id, { assigneeId: other.id });
    const team = await planBasicTurn({
      actor: w.actor,
      message: 'incidents for the checkout team',
      incident: null,
    });
    expect(team.text).toContain('Matching incidents');
    const person = await planBasicTurn({
      actor: w.actor,
      message: 'incidents assigned to Eval Responder',
      incident: null,
    });
    expect(person.text).toContain('Incidents assigned to Eval Responder');
    expect(person.text).toContain('7 matches');
    expect(person.text).not.toContain('Other person incident');
  });

  it('lists escalated incidents from real escalation events, not titles that say "escalated"', async () => {
    const w = await world();
    await db.incidentEvent.create({
      data: { incidentId: w.incidents[0].id, type: 'ESCALATED', message: 'Escalated to level 2' },
    });
    await createTestIncident('Escalated by customer', w.checkout.id, {
      assigneeId: w.responder.id,
    });
    const turn = await planBasicTurn({
      actor: w.actor,
      message: 'escalated incidents this week',
      incident: null,
    });
    expect(turn.text).toContain('Pool exhausted 1');
    expect(turn.text).not.toContain('Pool exhausted 2');
    expect(turn.text).not.toContain('Escalated by customer');
  });
});

describe('page context', () => {
  it('resolves service, team and schedule pages under the person\'s visibility and uses them for "this service"', async () => {
    const w = await world();
    const context = await resolvePageContext(w.actor, { kind: 'service', id: w.checkout.id });
    expect(context).toMatchObject({ kind: 'service', name: 'Checkout API', teamIds: [w.team.id] });
    expect(await resolvePageContext(w.actor, { kind: 'service', id: 'missing' })).toBeNull();
    const turn = await planBasicTurn({
      actor: w.actor,
      message: 'who is on call for this service',
      incident: null,
      page: context,
    });
    expect(turn.intent).toBe('ON_CALL');
    // The page's service is used; it has no escalation policy, so nothing unrelated is substituted.
    expect(turn.text).toContain('Checkout API');
    expect(turn.text).toContain('not substituted unrelated schedules');
    const open = await planBasicTurn({
      actor: w.actor,
      message: 'open incidents',
      incident: null,
      page: context,
    });
    expect(open.text).toContain('7 matches');
  });

  it('treats an alert page as its incident when the incident is readable', async () => {
    const w = await world();
    const alert = await db.alert.create({
      data: {
        incidentId: w.incidents[0].id,
        serviceId: w.checkout.id,
        payload: { summary: 'Pool exhausted' },
      },
    });
    const context = await resolvePageContext(w.actor, { kind: 'alert', id: alert.id });
    expect(context?.incidentId).toBe(w.incidents[0].id);
  });
});

describe('basic-mode proposals', () => {
  async function ask(
    actor: Awaited<ReturnType<typeof world>>['actor'],
    message: string,
    incidentId?: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ) {
    return collect(streamSquire(actor, { message, history, incidentId }));
  }

  it('turns an explicit acknowledge request into a sealed proposal card and never executes it', async () => {
    const w = await world();
    await db.aiSettings.create({ data: { id: 'default', enabled: false, squireEnabled: true } });
    const result = await ask(w.actor, 'acknowledge this', w.incidents[0].id);
    expect(result.meta).toMatchObject({ mode: 'basic', intent: 'RESPONDERS' });
    expect(result.text).toContain('Nothing happens until you confirm');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].proposal).toMatchObject({
      action: 'acknowledge_incident',
      kind: 'WRITE',
      incidentId: w.incidents[0].id,
    });
    expect(result.proposals[0].proposal.untrustedContext).toBeUndefined();
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incidents[0].id } })).status).toBe(
      'OPEN'
    );
    const slash = await ask(w.actor, '/ack', w.incidents[0].id);
    expect(slash.proposals[0]?.proposal.action).toBe('acknowledge_incident');
  });

  it('asks for the resolution note, then proposes resolving from the reply', async () => {
    const w = await world();
    await db.aiSettings.create({ data: { id: 'default', enabled: false, squireEnabled: true } });
    const first = await ask(w.actor, 'resolve this', w.incidents[1].id);
    expect(first.text).toContain('What fixed it');
    expect(first.proposals).toHaveLength(0);
    const second = await ask(
      w.actor,
      'rolled back release 42 and verified recovery',
      w.incidents[1].id,
      [
        { role: 'user', content: 'resolve this' },
        { role: 'assistant', content: first.text },
      ]
    );
    expect(second.proposals[0]?.proposal).toMatchObject({ action: 'resolve_incident' });
  });

  it('resolves a person for reassignment and refuses to guess between several', async () => {
    const w = await world();
    const reviewer = await createTestUser({ role: 'USER', name: 'Eval Reviewer' });
    await db.teamMember.create({
      data: { userId: reviewer.id, teamId: w.team.id, role: 'MEMBER' },
    });
    const exact = await planBasicTurn({
      actor: w.actor,
      message: 'assign this to Eval Responder',
      incident: {
        id: w.incidents[2].id,
        title: 'Pool exhausted 3',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceName: 'Checkout API',
        createdAt: new Date(),
      },
    });
    expect(exact.proposals).toEqual([
      {
        action: 'reassign_incident',
        input: { incidentId: w.incidents[2].id, assigneeId: w.responder.id },
      },
    ]);
    const ambiguous = await planBasicTurn({
      actor: w.actor,
      message: 'assign this to Eval',
      incident: {
        id: w.incidents[2].id,
        title: 'Pool exhausted 3',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceName: 'Checkout API',
        createdAt: new Date(),
      },
    });
    expect(ambiguous.proposals).toHaveLength(0);
    expect(ambiguous.text).toContain('Several people match');
    expect(ambiguous.nextState?.pending?.kind).toBe('person');
  });

  it('never proposes off an incident page or for a how-do-I question', async () => {
    const w = await world();
    const off = await planBasicTurn({
      actor: w.actor,
      message: 'acknowledge this',
      incident: null,
    });
    expect(off.proposals).toHaveLength(0);
    expect(off.text).toContain('Open the incident');
    const guidance = await planBasicTurn({
      actor: w.actor,
      message: 'how do I acknowledge an incident?',
      incident: {
        id: w.incidents[0].id,
        title: 'Pool exhausted 1',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceName: 'Checkout API',
        createdAt: new Date(),
      },
    });
    expect(guidance.intent).toBe('GUIDANCE');
    expect(guidance.proposals).toHaveLength(0);
  });
});

describe('caching and dialogue state persistence', () => {
  it('serves an identical question from the short cache without re-reading, and replays its evidence', async () => {
    const w = await world();
    const first = await planBasicTurn({
      actor: w.actor,
      message: 'my open incidents',
      incident: null,
    });
    expect(first.cached).toBe(false);
    await db.incident.create({
      data: {
        title: 'Arrived after the cache',
        serviceId: w.checkout.id,
        status: 'OPEN',
        urgency: 'LOW',
        assigneeId: w.responder.id,
      },
    });
    const snapshots: unknown[] = [];
    const second = await planBasicTurn(
      { actor: w.actor, message: 'my open incidents', incident: null },
      s => snapshots.push(s)
    );
    expect(second.cached).toBe(true);
    expect(second.text).toBe(first.text);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it('keeps the pending clarification on the saved conversation when history is on', async () => {
    const w = await world();
    await db.aiSettings.create({
      data: { id: 'default', enabled: false, squireEnabled: true, squireHistoryEnabled: true },
    });
    const id = await recordExchange({
      userId: w.responder.id,
      question: 'who owns pay',
      answer: 'Did you mean…',
    });
    const first = await collect(
      streamSquire(w.actor, { message: 'who owns pay', history: [], conversationId: id })
    );
    expect(first.text).toContain('Several services match');
    expect((await db.squireConversation.findUniqueOrThrow({ where: { id } })).state).toMatchObject({
      v: 1,
      pending: { kind: 'service' },
    });
    const second = await collect(
      streamSquire(w.actor, { message: 'Payments API', history: [], conversationId: id })
    );
    expect(second.text).toContain('## Payments API');
    expect((await db.squireConversation.findUniqueOrThrow({ where: { id } })).state).toBeNull();
  });

  it('keeps the pending clarification in the database without history, encrypted, for ten minutes', async () => {
    const w = await world();
    await db.aiSettings.create({ data: { id: 'default', enabled: false, squireEnabled: true } });
    const first = await collect(streamSquire(w.actor, { message: 'who owns pay', history: [] }));
    expect(first.text).toContain('Several services match');
    const [row] = await db.squireDialogueState.findMany({ where: { userId: w.responder.id } });
    expect(row.scopeKey).toBe('');
    expect(row.stateEncrypted).not.toContain('who owns pay');
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    // Nothing lives in process memory: another replica reads the same row and completes the question.
    const second = await collect(streamSquire(w.actor, { message: 'Payments API', history: [] }));
    expect(second.text).toContain('## Payments API');
    expect(
      await db.squireDialogueState.count({
        where: { userId: w.responder.id, expiresAt: { gt: new Date() } },
      })
    ).toBeLessThanOrEqual(1);

    // An expired clarification is ignored.
    await collect(streamSquire(w.actor, { message: 'who owns pay', history: [] }));
    const scope = { userId: w.responder.id, incidentId: null };
    expect((await readDialogueState(scope))?.pending?.kind).toBe('service');
    await db.squireDialogueState.updateMany({
      where: { userId: w.responder.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await readDialogueState(scope))?.pending).toBeUndefined();
  });
});

describe('suggested checks library', () => {
  it('uses administrator templates ahead of the built-in ones and rejects unsafe patterns', async () => {
    const w = await world();
    expect((await checksFor('Pool exhausted on db-2')).title).toBe('Connection pool exhaustion');
    const saved = await saveCheckTemplate(
      null,
      {
        title: 'Payments webhook retries',
        pattern: 'webhook.*retr|payment.*webhook',
        checks: ['Check the provider status page for webhook delays.'],
        position: 1,
      },
      w.admin.id
    );
    expect((await checksFor('Payment webhook retries climbing')).checks).toEqual([
      'Check the provider status page for webhook delays.',
    ]);
    expect((await listCheckTemplates()).filter(t => !t.builtIn)).toHaveLength(1);
    await expect(
      saveCheckTemplate(
        null,
        { title: 'Bad', pattern: '(a+)+$', checks: ['x'.repeat(10)] },
        w.admin.id
      )
    ).rejects.toThrow();
    expect(await deleteCheckTemplate(saved.id)).toBe(true);
    expect((await checksFor('Payment webhook retries climbing')).title).toBeNull();
  });
});

describe('answer feedback', () => {
  it('stores ratings without text and summarises them by mode, intent and reason', async () => {
    const w = await world();
    await recordFeedback(w.responder.id, {
      rating: 'UP',
      mode: 'basic',
      intent: 'WORK_QUEUE',
      question: 'my open incidents',
    });
    await recordFeedback(w.responder.id, {
      rating: 'DOWN',
      mode: 'basic',
      intent: 'ON_CALL',
      reason: 'outdated',
      note: 'shift changed',
    });
    const rows = await db.squireFeedback.findMany();
    expect(rows.map(r => r.questionHash)).not.toContain('my open incidents');
    expect(rows.find(r => r.rating === 'DOWN')?.reason).toBe('outdated: shift changed');
    const summary = await getFeedbackSummary(30);
    expect(summary).toMatchObject({ total: 2, up: 1, down: 1 });
    expect(summary.byIntent).toEqual(
      expect.arrayContaining([{ intent: 'WORK_QUEUE', up: 1, down: 0 }])
    );
    expect(summary.reasons).toEqual([{ reason: 'outdated', count: 1 }]);
  });
});

describe('calendar questions end to end', () => {
  it('answers "since Monday" and "between" with local-day windows', async () => {
    const w = await world();
    const since = await planBasicTurn({
      actor: w.actor,
      message: 'find incidents since monday',
      incident: null,
    });
    expect(since.intent).toBe('SEARCH_INCIDENTS');
    expect(since.text).toMatch(/matches in since \d{4}-\d{2}-\d{2}/);
    const between = await planBasicTurn({
      actor: w.actor,
      message: 'incidents between monday and today',
      incident: null,
    });
    expect(between.text).toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  });
});

describe('dialogue follow-ups from the adversarial review', () => {
  const onScreen = (w: Awaited<ReturnType<typeof world>>) => ({
    id: w.incidents[2].id,
    title: 'Pool exhausted 3',
    status: 'OPEN',
    urgency: 'HIGH',
    serviceName: 'Checkout API',
    createdAt: new Date(),
  });

  it('assigns to the person picked from a list by id, keeping names that re-parsing garbled', async () => {
    const w = await world();
    const names = ["Alice O'Brien", 'Alice Ortega'];
    const people = await Promise.all(names.map(name => createTestUser({ role: 'USER', name })));
    for (const person of people)
      await db.teamMember.create({
        data: { userId: person.id, teamId: w.team.id, role: 'MEMBER' },
      });
    const incident = onScreen(w);
    const ask = await planBasicTurn({ actor: w.actor, message: 'assign this to Alice', incident });
    expect(ask.nextState?.pending?.kind).toBe('person');
    const pick = await planBasicTurn({
      actor: w.actor,
      message: "Alice O'Brien",
      incident,
      state: ask.nextState,
    });
    expect(pick.proposals).toEqual([
      { action: 'reassign_incident', input: { incidentId: incident.id, assigneeId: people[0].id } },
    ]);
    const byNumber = await planBasicTurn({
      actor: w.actor,
      message: '2',
      incident,
      state: ask.nextState,
    });
    expect(byNumber.proposals[0]?.input).toMatchObject({ assigneeId: people[1].id });
    const me = await planBasicTurn({ actor: w.actor, message: 'assign this to me', incident });
    expect(me.proposals[0]?.input).toMatchObject({ assigneeId: w.responder.id });
  });

  it('cancels, ignores empty replies and takes a real question as new', async () => {
    const w = await world();
    const ask = await planBasicTurn({ actor: w.actor, message: 'who owns pay', incident: null });
    expect(ask.nextState?.pending?.kind).toBe('service');
    const cancel = await planBasicTurn({
      actor: w.actor,
      message: 'never mind',
      incident: null,
      state: ask.nextState,
    });
    expect(cancel.text).toContain('dropped');
    expect(cancel.nextState).toBeNull();
    const empty = await planBasicTurn({
      actor: w.actor,
      message: '?',
      incident: null,
      state: ask.nextState,
    });
    expect(empty.text).not.toContain('Payments API');
    const fresh = await planBasicTurn({
      actor: w.actor,
      message: 'my queue',
      incident: null,
      state: ask.nextState,
    });
    expect(fresh.intent).toBe('WORK_QUEUE');
  });

  it('completes a two-way clarification with the original subject', async () => {
    const w = await world();
    await createTestIncident('Billing glitch', w.payments.id, { assigneeId: w.responder.id });
    const state = pendingState('intent', 'checkout incidents?', 'UNKNOWN', [
      { label: 'Search incidents', id: 'SEARCH_INCIDENTS' },
      { label: 'My open incidents', id: 'WORK_QUEUE' },
    ]);
    const picked = await planBasicTurn({
      actor: w.actor,
      message: 'Search incidents',
      incident: null,
      state,
    });
    expect(picked.intent).toBe('SEARCH_INCIDENTS');
    expect(picked.text).toContain('keywords: checkout');
    expect(picked.text).not.toContain('Billing glitch');
  });

  it('keeps the person filter and intent on "show more"', async () => {
    const w = await world();
    const other = await createTestUser({ role: 'RESPONDER', name: 'Someone Else' });
    await createTestIncident('Other person incident', w.checkout.id, { assigneeId: other.id });
    const first = await planBasicTurn({
      actor: w.actor,
      message: 'incidents assigned to Eval Responder',
      incident: null,
    });
    expect(first.nextState?.page?.filters).toEqual({ assigneeId: w.responder.id });
    const next = await planBasicTurn({
      actor: w.actor,
      message: 'show me more',
      incident: null,
      state: first.nextState,
    });
    expect(next.intent).toBe(first.intent);
    expect(next.text).toContain('Showing 6–7 of 7');
    expect(next.text).not.toContain('Other person incident');
  });

  it('runs every list and report chip after the question that offered it', async () => {
    const w = await world();
    const chain: Array<[string, string, string]> = [
      ['list open incidents', 'Only high urgency', 'Pool exhausted'],
      ['list open incidents', 'Only the last 24 hours', 'Pool exhausted'],
      ['list open incidents', 'Group them by service', 'Checkout API'],
      ['How many incidents this week?', 'Break it down by team', '### By team'],
      ['How many incidents this week?', 'Compare with the previous period', 'incidents'],
    ];
    for (const [previous, chip, expected] of chain) {
      const next = await planBasicTurn({
        actor: w.actor,
        message: chip,
        incident: null,
        previousQuestions: [previous],
      });
      expect(next.intent, chip).not.toBe('UNKNOWN');
      expect(next.text, chip).toContain(expected);
      expect(next.text, chip).not.toContain('0 matches');
    }
    const grouped = await planBasicTurn({
      actor: w.actor,
      message: 'Group them by service',
      incident: null,
      previousQuestions: ['list open incidents'],
    });
    expect(grouped.intent).toBe('INCIDENT_STATS');
  });

  it('refuses /ack for another incident and normalises tag names', async () => {
    const w = await world();
    const incident = onScreen(w);
    const other = await planBasicTurn({ actor: w.actor, message: '/ack INC-42', incident });
    expect(other.proposals).toHaveLength(0);
    expect(other.text).toContain('is not it');
    const same = await planBasicTurn({
      actor: w.actor,
      message: `/ack #${incident.id.slice(-5).toUpperCase()}`,
      incident,
    });
    expect(same.proposals[0]?.action).toBe('acknowledge_incident');
    const tag = await planBasicTurn({ actor: w.actor, message: '/tag "database"\n', incident });
    expect(tag.operation?.args).toMatchObject({ body: { name: 'database' } });
  });
});
