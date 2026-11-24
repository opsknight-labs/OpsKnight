import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { planBasicTurn } from '@/lib/intelligence/squire/deterministic';
import {
  detectEntityReferences,
  entityHintsForPrompt,
  resolveEntityReferences,
} from '@/lib/intelligence/squire/entity-refs';
import { resetEntityCache } from '@/lib/intelligence/squire/basic/entities';
import { resetBasicReadCaches } from '@/lib/intelligence/squire/basic/reads';
import { resetDialogueMemory } from '@/lib/intelligence/assistant/dialogue-state';
import type { SquireIntent } from '@/lib/intelligence/squire/intents';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestStatusPage,
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
});

async function world() {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
  const team = await createTestTeam('Checkout');
  const outsiders = await createTestTeam('Outsiders');
  // A team-scoped user, so visibility rules are really exercised.
  const responder = await createTestUser({ role: 'USER', name: 'Eval Responder' });
  await db.teamMember.create({ data: { userId: responder.id, teamId: team.id, role: 'MEMBER' } });
  const checkout = await createTestService('Checkout API', team.id, { name: 'Checkout API' });
  await createTestService('Payments Worker', team.id, { name: 'Payments Worker' });
  const hidden = await createTestService('Hidden Payroll', outsiders.id, {
    name: 'Hidden Payroll',
  });
  const incident = await createTestIncident('Pool exhausted', checkout.id, {
    assigneeId: responder.id,
  });
  const hiddenIncident = await createTestIncident('Payroll secret outage', hidden.id, {
    teamId: outsiders.id,
  });
  const schedule = await createTestOnCallSchedule('Primary', [
    { start: new Date(Date.now() - 3_600_000), userIds: [responder.id] },
  ]);
  await db.onCallSchedule.update({
    where: { id: schedule.id },
    data: { name: 'Primary Rotation' },
  });
  const secret = await createTestOnCallSchedule('Secret', [{ userIds: [admin.id] }]);
  await db.onCallSchedule.update({ where: { id: secret.id }, data: { name: 'Secret Rotation' } });
  const policy = await createTestEscalationPolicy(
    'Sev1 Escalation',
    [{ stepOrder: 0, delayMinutes: 5, targetType: 'SCHEDULE', targetScheduleId: schedule.id }],
    { name: 'Sev1 Escalation' }
  );
  const statusPage = await createTestStatusPage({ name: 'Customer Status' });
  const runbook = await db.runbook.create({
    data: {
      name: 'Database pool reset',
      slug: 'database-pool-reset',
      description: 'Resets the pool',
      tags: ['database'],
    },
  });
  const alert = await db.alert.create({
    data: { incidentId: incident.id, serviceId: checkout.id, payload: { summary: 'Pool' } },
  });
  const change = await db.changeEvent.create({
    data: {
      serviceId: checkout.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'Checkout release 42',
      occurredAt: new Date(Date.now() - 600_000),
    },
  });
  const postmortem = await db.postmortem.create({
    data: { incidentId: incident.id, title: 'Pool postmortem', status: 'PUBLISHED' },
  });
  return {
    actor: (await resolveUserActor(responder.id))!,
    adminActor: (await resolveUserActor(admin.id))!,
    ...{ team, responder, checkout, hidden, incident, hiddenIncident, schedule, secret },
    ...{ policy, statusPage, runbook, alert, change, postmortem },
  };
}

type World = Awaited<ReturnType<typeof world>>;
const ask = (actor: World['actor'], message: string) =>
  planBasicTurn({ actor, message, incident: null });

describe('records named by link or id', () => {
  it('answers about every kind the person can read, from a link, "<kind> <id>" or a bare id', async () => {
    const w = await world();
    const cases: Array<[World['actor'], string, SquireIntent, string[]]> = [
      [w.actor, `/services/${w.checkout.id}`, 'SERVICE_HEALTH', ['## Checkout API']],
      [
        w.actor,
        `what's up with https://ops.example.com/services/${w.checkout.id}?tab=1`,
        'SERVICE_HEALTH',
        ['## Checkout API', 'Visible active incidents'],
      ],
      [w.actor, `team ${w.team.id}`, 'ACTIVE_INCIDENTS', ['Pool exhausted']],
      [
        w.actor,
        `who is on call for schedule ${w.schedule.id}`,
        'ON_CALL',
        ['Eval Responder', 'Primary Rotation'],
      ],
      [w.actor, w.schedule.id, 'ON_CALL', ['Primary Rotation']],
      [w.actor, `/m/users/${w.responder.id}`, 'RESPONDERS', ['Eval Responder', `/users/`]],
      [w.actor, `/alerts/${w.alert.id}`, 'INCIDENT_SUMMARY', ['Pool exhausted']],
      [w.actor, `change ${w.change.id}`, 'RECENT_CHANGES', ['Checkout release 42', '/changes/']],
      [
        w.actor,
        `/postmortems/${w.incident.id}`,
        'POSTMORTEMS',
        ['Pool postmortem', `/postmortems/${w.incident.id}`],
      ],
      [w.actor, `incident #${w.incident.id.slice(-5)}`, 'INCIDENT_SUMMARY', ['Pool exhausted']],
      [
        w.adminActor,
        `/policies/${w.policy.id}`,
        'SERVICE_HEALTH',
        ['Sev1 Escalation', '1 step, delays 5 min', `/policies/${w.policy.id}`],
      ],
      [
        w.adminActor,
        `status page ${w.statusPage.id}`,
        'SERVICE_HEALTH',
        ['Customer Status', `/settings/status-pages/${w.statusPage.id}`],
      ],
      [
        w.adminActor,
        `show runbook ${w.runbook.id}`,
        'RUNBOOK_SEARCH',
        ['Runbook: Database pool reset', 'Resets the pool', `/runbooks/${w.runbook.id}`],
      ],
    ];
    for (const [actor, message, intent, texts] of cases) {
      const turn = await ask(actor, message);
      expect(turn.intent, message).toBe(intent);
      for (const text of texts) expect(turn.text, message).toContain(text);
      expect(turn.text, message).not.toContain('0 matches');
    }
  });

  it('gives the same answer for a hidden record as for a missing one, and never names it', async () => {
    const w = await world();
    const missing = 'cmissing0missing0missing0';
    const pairs: Array<[string, string]> = [
      [`service ${w.hidden.id}`, `service ${missing}`],
      [`/incidents/${w.hiddenIncident.id}`, `/incidents/${missing}`],
      [w.hidden.id, missing],
      [`schedule ${w.secret.id}`, `schedule ${missing}`],
      // A user may not read runbooks or escalation policies at all.
      [`runbook ${w.runbook.id}`, `runbook ${missing}`],
      [`/policies/${w.policy.id}`, `/policies/${missing}`],
    ];
    for (const [hidden, absent] of pairs) {
      const [a, b] = [await ask(w.actor, hidden), await ask(w.actor, absent)];
      expect(a.text, hidden).toBe(b.text);
      expect(a.text, hidden).toMatch(/can’t find/);
      expect(a.text).not.toMatch(/Hidden Payroll|Payroll secret|Secret Rotation|Database pool/);
    }
    const [secretName, noName] = await Promise.all([
      ask(w.actor, 'who is on call for the secret rotation schedule'),
      ask(w.actor, 'who is on call for the summer rotation schedule'),
    ]);
    expect(secretName.text).toContain('I can’t find a schedule called “secret rotation”');
    expect(noName.text).toContain('I can’t find a schedule called “summer rotation”');
  });
});

describe('records named in words', () => {
  it('matches schedules, teams, policies and runbooks by name under the person’s permissions', async () => {
    const w = await world();
    const schedule = await ask(w.actor, 'who is on call for the primary rotation schedule');
    expect(schedule.intent).toBe('ON_CALL');
    expect(schedule.text).toContain('Eval Responder');
    const team = await ask(w.actor, `tell me about the ${w.team.name} team`);
    expect(team.text).toContain('Pool exhausted');
    const runbook = await ask(w.adminActor, 'show the database runbook');
    expect(runbook.text).toContain('Runbook: Database pool reset');
    expect(runbook.text).toContain(`/runbooks/${w.runbook.id}`);
    const policy = await ask(w.adminActor, 'tell me about the sev1 escalation policy');
    expect(policy.text).toContain(`/policies/${w.policy.id}`);
  });

  it('resolves references for the prompt and renders one sanitised line per readable record', async () => {
    const w = await world();
    const refs = detectEntityReferences(
      `compare /services/${w.checkout.id} with service ${w.hidden.id} and the primary rotation schedule`
    );
    const resolved = await resolveEntityReferences(w.actor, refs);
    expect(resolved.map(entity => entity?.kind ?? null)).toEqual(['service', null, 'schedule']);
    const hints = entityHintsForPrompt(resolved).split('\n');
    expect(hints).toEqual([
      `- The user referred to the service "Checkout API" (id ${w.checkout.id}) /services/${w.checkout.id}`,
      `- The user referred to the schedule "Primary Rotation" (id ${w.schedule.id}) /schedules/${w.schedule.id}`,
    ]);
  });
});

describe('everyday questions in basic mode', () => {
  it('routes common on-call questions to a real answer, and links the docs for how-to questions', async () => {
    const w = await world();
    const cases: Array<[string, SquireIntent, string?]> = [
      ['hi', 'GREETING'],
      ['hello squire, what can you do?', 'HELP', 'I can help with live OpsKnight data'],
      ['what can you do', 'HELP'],
      ['how do I create an escalation policy', 'GUIDANCE', 'Read the guide'],
      ["what's the difference between ack and resolve", 'GUIDANCE', 'Acknowledge and resolve'],
      ['who am I', 'IDENTITY', 'Eval Responder'],
      ["what's my role", 'IDENTITY', 'Role: **User**'],
      ['what permissions do I have', 'IDENTITY', 'Role: **User**'],
      ['list my teams', 'IDENTITY', w.team.name],
      ['what teams am I on', 'IDENTITY', w.team.name],
      ['list my services', 'SERVICE_HEALTH', 'Services you can view'],
      ['what does SEV1 mean', 'GUIDANCE', 'SEV1'],
      ['what is MTTR', 'GUIDANCE', 'mean time to resolve'],
      ["what's the MTTA this week", 'INCIDENT_STATS'],
      ['how many incidents in the last 24 hours', 'INCIDENT_STATS', 'past 24 hours'],
      ['incidents from yesterday', 'SEARCH_INCIDENTS'],
      ['whos on cal', 'ON_CALL'],
      ['show me open incidnets', 'ACTIVE_INCIDENTS', 'Pool exhausted'],
      ['how do I add an override', 'GUIDANCE', 'Read the guide'],
      ['how do I connect slack', 'GUIDANCE', 'Read the guide'],
      ['how do I invite a user', 'GUIDANCE', 'Read the guide'],
      ['what is an escalation policy', 'GUIDANCE'],
      ['what is a service', 'GUIDANCE', '## Services'],
      ['how do I silence alerts during a deploy', 'GUIDANCE', 'Maintenance'],
      ['is checkout api healthy', 'SERVICE_HEALTH', '## Checkout API'],
      ['who owns checkout api', 'SERVICE_HEALTH', '## Checkout API'],
      ['what changed in the last hour', 'RECENT_CHANGES'],
      ['any overdue action items', 'FOLLOWUPS'],
      ['how do I set up a status page', 'GUIDANCE'],
      ['what is a postmortem', 'GUIDANCE'],
      ['what is basic mode', 'GUIDANCE'],
      ['thanks!', 'THANKS'],
      ['am I on call', 'CATCH_UP', 'You are on call now for Primary Rotation'],
      ["what's my next on-call shift", 'CATCH_UP', 'Primary Rotation'],
      ['who is on call and how many incidents are open?', 'ON_CALL', 'Incident report'],
      ['tell me a joke', 'UNKNOWN'],
    ];
    for (const [message, intent, text] of cases) {
      const turn = await ask(w.actor, message);
      expect(turn.intent, message).toBe(intent);
      if (text) expect(turn.text, message).toContain(text);
    }
  });

  it('answers each question of a multi-question message in turn', async () => {
    const w = await world();
    const turn = await ask(w.actor, 'show open incidents and who is on call?');
    expect(turn.intent).toBe('ACTIVE_INCIDENTS');
    expect(turn.text).toContain('Pool exhausted');
    expect(turn.text).toContain('On-call coverage');
    // One question that happens to contain "and" stays whole.
    const whole = await ask(w.actor, 'how do I acknowledge and resolve an incident');
    expect(whole.intent).toBe('GUIDANCE');
    expect(whole.text).not.toContain('---');
  });
});
