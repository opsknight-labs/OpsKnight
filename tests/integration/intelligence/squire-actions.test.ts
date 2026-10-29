import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () =>
    session.userId ? { user: { id: session.userId, tokenVersion: 0 } } : null
  ),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { buildProposal } from '@/lib/intelligence/squire/actions/proposals';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

let model: FakeServer;
beforeAll(async () => {
  model = await startFakeModel();
});
afterAll(async () => {
  await model.close();
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  model.requests.length = 0;
  model.script.length = 0;
  session.userId = '';
  invalidateGatewayCache();
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function setup(maxDataClass: 'INTERNAL' | 'PERSONAL' = 'PERSONAL') {
  const admin = await createTestUser({ role: 'ADMIN' });
  const ctx = { actorId: admin.id, source: 'UI' as const };
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    ctx
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 100,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 512,
      requestTimeoutMs: 10_000,
      expectedRevision: 0,
    },
    ctx
  );
  const provider = await saveAiProvider(
    null,
    {
      name: 'Local',
      kind: 'OPENAI_COMPATIBLE',
      model: 'm',
      baseUrl: model.url,
      apiKey: 'k',
      enabled: true,
      isExternal: false,
      maxDataClass,
      allowPrivateNetwork: true,
      priority: 1,
    },
    ctx
  );
  breakers.recordSuccess(provider.id);
  invalidateGatewayCache();
  return admin;
}

async function turn(userId: string, message: string, incidentId?: string): Promise<SquireEvent[]> {
  const events: SquireEvent[] = [];
  for await (const event of streamSquire(await actorOf(userId), {
    message,
    history: [],
    ...(incidentId ? { incidentId } : {}),
  })) {
    events.push(event);
  }
  return events;
}

const proposalsOf = (events: SquireEvent[]) =>
  events
    .filter((e): e is Extract<SquireEvent, { type: 'proposal' }> => e.type === 'proposal')
    .map(e => e.proposal);
const toolNamesSent = () =>
  ((model.requests[0]?.body.tools as Array<{ function: { name: string } }> | undefined) ?? []).map(
    t => t.function.name
  );

async function world() {
  const teamA = await createTestTeam('Team A');
  const teamB = await createTestTeam('Team B');
  const serviceA = await createTestService('Service A', teamA.id);
  const serviceB = await createTestService('Service B', teamB.id);
  const responder = await createTestUser({ role: 'RESPONDER' });
  await db.teamMember.create({ data: { userId: responder.id, teamId: teamA.id, role: 'MEMBER' } });
  const outsider = await createTestUser({ role: 'RESPONDER' });
  await db.teamMember.create({ data: { userId: outsider.id, teamId: teamB.id, role: 'MEMBER' } });
  // Responders read everything; a plain member sees only their team's incidents.
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
  const mine = await createTestIncident('Checkout latency high', serviceA.id, { teamId: teamA.id });
  const created = await createTestIncident('Payroll database corruption', serviceB.id, {
    teamId: teamB.id,
  });
  // Responders can read every public incident; a private one belongs to its team only.
  const theirs = await db.incident.update({
    where: { id: created.id },
    data: { visibility: 'PRIVATE' },
  });
  return { responder, outsider, member, mine, theirs };
}

describe('proposed actions', () => {
  it('proposes, changes nothing until confirmed, then acknowledges once through the normal command', async () => {
    await setup();
    const { responder, mine } = await world();
    model.script.push(
      {
        toolCall: {
          name: 'propose_acknowledge_incident',
          args: JSON.stringify({ incidentId: mine.id }),
        },
      },
      { content: 'I suggested acknowledging it.' }
    );
    const events = await turn(responder.id, 'please ack this', mine.id);
    const [proposal] = proposalsOf(events);
    expect(proposal).toMatchObject({
      action: 'acknowledge_incident',
      kind: 'WRITE',
      incidentId: mine.id,
      title: 'Acknowledge incident',
    });
    expect(proposal.token).not.toContain(mine.id); // sealed, not readable
    expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('OPEN');

    session.userId = responder.id;
    expect(await executeSquireAction(await actorOf(responder.id), proposal.token)).toMatchObject({
      ok: true,
      message: 'Incident acknowledged.',
    });
    expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe(
      'ACKNOWLEDGED'
    );
    expect(
      await db.auditLog.count({
        where: { action: 'intelligence.squire.action', entityId: mine.id },
      })
    ).toBe(1);

    // A double click or a replayed request does nothing more.
    expect(await executeSquireAction(await actorOf(responder.id), proposal.token)).toEqual({
      ok: false,
      message: 'This has already been done.',
    });
  });

  it('adds a note as the confirming person, through the same path as the incident page', async () => {
    await setup();
    const { responder, mine } = await world();
    const proposal = await buildProposal(await actorOf(responder.id), 'add_incident_note', {
      incidentId: mine.id,
      content: 'Rolled back v42',
    });
    session.userId = responder.id;
    expect(await executeSquireAction(await actorOf(responder.id), proposal!.token)).toMatchObject({
      ok: true,
    });
    const note = await db.incidentNote.findFirstOrThrow({ where: { incidentId: mine.id } });
    expect(note).toMatchObject({ userId: responder.id, content: 'Rolled back v42' });
  });

  it('never proposes or performs an action on an incident the person cannot read', async () => {
    await setup();
    const { responder, outsider, member, mine, theirs } = await world();
    expect(
      await buildProposal(await actorOf(member.id), 'acknowledge_incident', {
        incidentId: theirs.id,
      })
    ).toBeNull();

    // A proposal made for one person is useless to anyone else.
    const proposal = await buildProposal(await actorOf(responder.id), 'acknowledge_incident', {
      incidentId: mine.id,
    });
    session.userId = outsider.id;
    expect(await executeSquireAction(await actorOf(outsider.id), proposal!.token)).toMatchObject({
      ok: false,
    });
    expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('OPEN');
  });

  it('refuses forged, altered and expired proposals', async () => {
    await setup();
    const { responder, mine } = await world();
    const actor = await actorOf(responder.id);
    session.userId = responder.id;
    expect(await executeSquireAction(actor, 'not-a-token')).toMatchObject({ ok: false });
    const fresh = await buildProposal(actor, 'acknowledge_incident', { incidentId: mine.id });
    expect(await executeSquireAction(actor, `${fresh!.token.slice(0, -4)}AAAA`)).toMatchObject({
      ok: false,
    });
    const stale = await buildProposal(
      actor,
      'acknowledge_incident',
      { incidentId: mine.id },
      new Date(Date.now() - 11 * 60_000)
    );
    expect(await executeSquireAction(actor, stale!.token)).toEqual({
      ok: false,
      message: 'This suggestion has expired. Ask again for a fresh one.',
    });
    expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('OPEN');
  });

  it("still applies the application's own permission checks when confirmed", async () => {
    await setup();
    const { mine } = await world();
    const viewer = await createTestUser({ role: 'USER' });
    const actor = await actorOf(viewer.id);
    const proposal = await buildProposal(actor, 'resolve_incident', {
      incidentId: mine.id,
      resolution: 'Restarted the pods and it recovered.',
    });
    if (!proposal) return; // not even visible to this viewer: also a refusal
    session.userId = viewer.id;
    expect(await executeSquireAction(actor, proposal.token)).toMatchObject({ ok: false });
    expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('OPEN');
  });

  it('offers navigation suggestions as links and runs nothing for them', async () => {
    await setup();
    const { responder, mine } = await world();
    const proposal = await buildProposal(await actorOf(responder.id), 'draft_postmortem', {
      incidentId: mine.id,
    });
    expect(proposal).toMatchObject({ kind: 'NAVIGATE', href: `/postmortems/${mine.id}` });
    session.userId = responder.id;
    expect(await executeSquireAction(await actorOf(responder.id), proposal!.token)).toMatchObject({
      ok: false,
    });
  });
});

describe('answers', () => {
  it('offers people and timeline tools only when the provider may receive Personal data', async () => {
    await setup('INTERNAL');
    const { responder, mine } = await world();
    model.script.push({ content: 'ok' });
    await turn(responder.id, 'who is on call?', mine.id);
    expect(toolNamesSent()).not.toEqual(expect.arrayContaining(['get_timeline']));
    expect(toolNamesSent()).not.toContain('who_is_on_call');
    expect(toolNamesSent()).not.toContain('propose_reassign_incident');
    expect(toolNamesSent()).toContain('propose_acknowledge_incident');
  });

  it('includes them for a Personal-data provider, and briefs the model on the incident up front', async () => {
    await setup('PERSONAL');
    const { responder, mine } = await world();
    model.script.push({ content: 'ok' });
    await turn(responder.id, 'what now?', mine.id);
    expect(toolNamesSent()).toEqual(
      expect.arrayContaining([
        'get_timeline',
        'who_is_on_call',
        'find_people',
        'propose_reassign_incident',
      ])
    );
    const system = (
      model.requests[0].body.messages as Array<{ role: string; content: string }>
    ).find(m => m.role === 'system')!;
    expect(system.content).toContain(`/incidents/${mine.id}`);
    expect(system.content).toContain('Checkout latency high');
  });

  it('cites only incidents the person can open, and offers follow-up questions', async () => {
    await setup();
    const { member, mine, theirs } = await world();
    model.script.push({
      content: `See /incidents/${mine.id} and /incidents/${theirs.id} and /incidents/made-up`,
    });
    const events = await turn(member.id, 'anything similar?', mine.id);
    const citations = events.find(
      (e): e is Extract<SquireEvent, { type: 'citations' }> => e.type === 'citations'
    );
    expect(citations?.items.map(c => c.id)).toEqual([mine.id]);
    expect(events.some(e => e.type === 'suggestions')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('never ends with an empty answer when the model spends every step on tools', async () => {
    await setup();
    const { responder, mine } = await world();
    for (let i = 0; i < 8; i += 1)
      model.script.push({
        toolCall: { name: 'get_incident', args: JSON.stringify({ id: mine.id }) },
      });
    const events = await turn(responder.id, 'tell me everything', mine.id);
    expect(events.some(e => e.type === 'notice')).toBe(true);
    const text = events
      .filter((e): e is Extract<SquireEvent, { type: 'delta' }> => e.type === 'delta')
      .map(e => e.text)
      .join('');
    expect(text).toContain('Checkout latency high');
    expect(events.some(e => e.type === 'tool')).toBe(true);
  });
});
