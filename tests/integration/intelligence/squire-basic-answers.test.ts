import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { resetDialogueMemory } from '@/lib/intelligence/assistant/dialogue-state';
import { duration, resetBasicReadCaches } from '@/lib/intelligence/squire/basic/reads';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import {
  planBasicTurn,
  readIncidentForActor,
  resolvePageContext,
} from '@/lib/intelligence/squire/deterministic';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

type Actor = NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>;

async function settings(extendedActions: boolean) {
  await db.aiSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireHistoryEnabled: false,
      squireExtendedActions: extendedActions,
    },
    update: { squireExtendedActions: extendedActions },
  });
}

async function world() {
  const platform = await createTestTeam('Platform', { name: 'Platform' });
  const hidden = await createTestTeam('Hidden', { name: 'Hidden Ops' });
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
  const responder = await createTestUser({ role: 'RESPONDER', name: 'Rae Responder' });
  const member = await createTestUser({ role: 'USER', name: 'Mo Member' });
  const secret = await createTestUser({ role: 'USER', name: 'Sam Secret' });
  for (const user of [admin, responder, member])
    await db.teamMember.create({ data: { userId: user.id, teamId: platform.id } });
  await db.teamMember.create({ data: { userId: secret.id, teamId: hidden.id } });
  const service = await createTestService('Checkout API', platform.id, { name: 'Checkout API' });
  const runbook = await db.runbook.create({
    data: { name: 'Fix: pool', slug: 'fix-pool', description: 'Drafted by Squire' },
  });
  const draft = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      checksum: 'x',
      definition: {
        steps: [
          {
            key: 'a',
            name: 'Restart pgbouncer',
            type: 'MANUAL',
            config: { command: 'kubectl rollout restart secret-cmd' },
          },
        ],
      },
    },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { draftVersionId: draft.id } });
  const resolved = await createTestIncident('Checkout DB pool exhausted', service.id, {
    teamId: platform.id,
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  await db.incidentNote.create({
    data: { incidentId: resolved.id, userId: admin.id, content: 'Restarted the pgbouncer pods.' },
  });
  await db.incidentNote.create({
    data: {
      incidentId: resolved.id,
      userId: admin.id,
      content: 'Resolution: Raised max pool size.',
    },
  });
  const open = await createTestIncident('Checkout latency high', service.id, {
    teamId: platform.id,
  });
  const actor = async (id: string) => (await resolveUserActor(id))!;
  return {
    admin: await actor(admin.id),
    responder: await actor(responder.id),
    member: await actor(member.id),
    runbook,
    resolved,
    open,
  };
}

async function plan(actor: Actor, message: string, extra: Record<string, unknown> = {}) {
  return planBasicTurn({ actor, message, incident: null, ...extra });
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  await resetDialogueMemory();
  resetBasicReadCaches();
  await settings(false);
});

describe('basic answers about the record in view', () => {
  it('answers about the runbook on screen; draft steps only for runbook managers, never config', async () => {
    const { admin, responder, runbook } = await world();
    for (const [actor, seesDraft] of [
      [admin, true],
      [responder, false],
    ] as const) {
      const page = await resolvePageContext(actor, { kind: 'runbook', id: runbook.id });
      const steps = await plan(actor, 'what steps does this runbook have', { page });
      expect(steps.intent).toBe('RUNBOOK_SEARCH');
      expect(steps.text).toContain('Draft only');
      expect(steps.text.includes('Restart pgbouncer')).toBe(seesDraft);
      expect(steps.text).not.toContain('secret-cmd');
      const publish = await plan(actor, 'publish this runbook', { page });
      expect(publish.text).toContain(`/runbooks/${runbook.id}`);
      expect(publish.text).toMatch(/can't publish from chat/);
      const add = await plan(actor, 'can you add the needed steps?', { page });
      expect(add.text).toContain('AI turned on');
    }
  });

  it('shows how a resolved incident was fixed from its notes', async () => {
    const { admin, resolved } = await world();
    const incident = await readIncidentForActor(admin, resolved.id);
    const answer = await plan(admin, 'how was this fixed?', { incident });
    expect(answer.intent).toBe('TIMELINE');
    expect(answer.text).toContain('Recorded resolution:** Raised max pool size.');
    expect(answer.text).toContain('Restarted the pgbouncer pods.');
  });

  it('offers the fix-to-runbook card, or says why not', async () => {
    const { admin, resolved } = await world();
    const incident = await readIncidentForActor(admin, resolved.id);
    const off = await plan(admin, 'turn this fix into a runbook', { incident });
    expect(off.cards).toBeUndefined();
    expect(off.text).toContain('Extended assistant actions');
    await settings(true);
    const on = await plan(admin, 'turn this fix into a runbook', { incident });
    expect(on.cards?.[0]?.title).toBe('Turn this fix into a runbook');
    expect(on.text).toContain('nothing is created until you confirm');
    // The chat stream delivers the card, not just the text about it.
    const kinds: string[] = [];
    for await (const event of streamSquire(admin, {
      message: 'turn this fix into a runbook',
      history: [],
      incidentId: resolved.id,
    }))
      if (event.type === 'proposal') kinds.push(event.proposal.title);
    expect(kinds).toEqual(['Turn this fix into a runbook']);
  });

  it('keeps a new request from being taken as the awaited resolution note', async () => {
    const { admin, open } = await world();
    const incident = await readIncidentForActor(admin, open.id);
    const ask = await plan(admin, 'can you resolve this incident?', { incident });
    expect(ask.text).toContain('What fixed it?');
    const next = await plan(admin, 'assign this to me', { incident, state: ask.nextState });
    expect(next.proposals.map(p => p.action)).toEqual(['reassign_incident']);
  });
});

describe('basic team answers', () => {
  it('lists and names members only within what the person may read', async () => {
    const { admin, member } = await world();
    const all = await plan(admin, 'list teams');
    expect(all.text).toContain('Hidden Ops');
    const mine = await plan(member, 'list teams');
    expect(mine.text).toContain('Platform');
    expect(mine.text).not.toContain('Hidden Ops');
    const members = await plan(member, 'who is on the Platform team');
    expect(members.text).toContain('Rae Responder');
    const hidden = await plan(member, 'who is on the hidden ops team');
    expect(hidden.text).toContain('No team called');
    expect(hidden.text).not.toContain('Sam Secret');
  });

  it('reads a duration without an impossible "60 min" remainder', () => {
    expect(duration(42)).toBe('42 min');
    expect(duration(119.5)).toBe('2 h 0 min');
    expect(duration(185)).toBe('3 h 5 min');
  });
});
