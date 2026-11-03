import { revalidatePath } from 'next/cache';
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
import { readSquireActionOutcome } from '@/lib/intelligence/squire/actions/outcomes';
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
    expect(await executeSquireAction(await actorOf(responder.id), proposal.token)).toMatchObject({
      ok: true,
      message: 'Incident acknowledged.',
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
  it('uses basic mode without sending any tools to an Internal-only provider', async () => {
    await setup('INTERNAL');
    const { responder, mine } = await world();
    model.script.push({ content: 'ok' });
    await turn(responder.id, 'who is on call?', mine.id);
    expect(toolNamesSent()).not.toEqual(expect.arrayContaining(['get_timeline']));
    expect(toolNamesSent()).not.toContain('who_is_on_call');
    expect(toolNamesSent()).not.toContain('propose_reassign_incident');
    expect(model.requests).toHaveLength(0);
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

it('keeps a confirmed mutation single-use when refreshing the page fails', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'Only once',
  });
  vi.mocked(revalidatePath).mockImplementationOnce(() => {
    throw new Error('Cache unavailable');
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: true });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
    ok: true,
    message: 'Note added.',
  });
  expect(
    await db.incidentNote.count({ where: { incidentId: mine.id, content: 'Only once' } })
  ).toBe(1);
});

it('commits an encrypted note outcome atomically and recovers it after the proposal deadline', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'recovery-private-canary-41',
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: true });
  const receipt = await db.squireActionReceipt.findUniqueOrThrow({
    where: { id: proposal!.receiptId! },
  });
  expect(receipt.status).toBe('SUCCEEDED');
  expect(receipt.intentEncrypted).not.toContain('recovery-private-canary-41');
  expect(receipt.resultEncrypted).not.toContain('Note added.');
  const future = new Date(Date.now() + 20 * 60_000);
  expect(await readSquireActionOutcome(actor, receipt.id, future)).toMatchObject({
    status: 'SUCCEEDED',
    result: { ok: true, message: 'Note added.' },
  });
  expect(
    await readSquireActionOutcome(actor, receipt.id, new Date(Date.now() + 25 * 60 * 60_000))
  ).toBeNull();
  const outsider = await actorOf((await createTestUser({ role: 'ADMIN' })).id);
  expect(await readSquireActionOutcome(outsider, receipt.id)).toBeNull();
});

it('concurrent note confirmations produce only one native note and one completed receipt', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'Concurrent once',
  });
  const results = await Promise.all([
    executeSquireAction(actor, proposal!.token),
    executeSquireAction(actor, proposal!.token),
  ]);
  expect(results.some(result => result.ok)).toBe(true);
  expect(
    await db.incidentNote.count({ where: { incidentId: mine.id, content: 'Concurrent once' } })
  ).toBe(1);
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'SUCCEEDED',
  });
});

it('rolls back a note when the executor fails before the transaction commits and never repeats the attempt', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'Rollback canary',
  });
  const notes = await import('@/lib/incidents/notes');
  const original = notes.addIncidentNoteDomainCommand;
  const fault = vi
    .spyOn(notes, 'addIncidentNoteDomainCommand')
    .mockImplementationOnce(async (input, tx) => {
      await original(input, tx);
      throw new Error('Injected failure before transaction commit');
    });
  try {
    expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: false });
  } finally {
    fault.mockRestore();
  }
  expect(
    await db.incidentNote.count({ where: { incidentId: mine.id, content: 'Rollback canary' } })
  ).toBe(0);
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'UNKNOWN',
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
    ok: false,
    message: expect.stringContaining('unknown'),
  });
  expect(
    await db.incidentNote.count({ where: { incidentId: mine.id, content: 'Rollback canary' } })
  ).toBe(0);
});

it('does not interpret a legacy consumed receipt or abandoned reservation as success', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  for (const status of ['UNKNOWN', 'RESERVED', 'RUNNING']) {
    const proposal = await buildProposal(actor, 'add_incident_note', {
      incidentId: mine.id,
      content: 'Never resume automatically',
    });
    await db.squireActionReceipt.create({
      data: {
        id: proposal!.receiptId!,
        userId: actor.id,
        incidentId: mine.id,
        action: 'add_incident_note',
        status,
        createdAt: new Date(Date.now() - 180_000),
      },
    });
    expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
      status: 'UNKNOWN',
    });
    expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
      ok: false,
      message: expect.stringContaining('unknown'),
    });
  }
  expect(await db.incidentNote.count({ where: { incidentId: mine.id } })).toBe(0);
});

it('rechecks incident access before returning a previous action outcome', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'Private result',
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: true });
  await db.incident.update({ where: { id: mine.id }, data: { visibility: 'PRIVATE' } });
  await db.teamMember.deleteMany({ where: { userId: responder.id } });
  await db.user.update({ where: { id: responder.id }, data: { role: 'USER' } });
  expect(
    await readSquireActionOutcome(await actorOf(responder.id), proposal!.receiptId!)
  ).toBeNull();
});

it.each(['resolve_incident', 'reassign_incident', 'link_related_incident'] as const)(
  'commits the %s outcome with its native mutation and replays only the result',
  async action => {
    await setup();
    const { responder, outsider, mine, theirs } = await world();
    const actor = await actorOf(responder.id);
    session.userId = responder.id;
    const input =
      action === 'resolve_incident'
        ? { incidentId: mine.id, resolution: 'Restored the database pool and verified recovery.' }
        : action === 'reassign_incident'
          ? { incidentId: mine.id, assigneeId: outsider.id }
          : { incidentId: mine.id, otherIncidentId: theirs.id };
    const proposal = await buildProposal(actor, action, input);
    expect(proposal).not.toBeNull();
    const first = await executeSquireAction(actor, proposal!.token);
    expect(first.ok).toBe(true);
    expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
      status: 'SUCCEEDED',
      result: first,
    });
    expect(await executeSquireAction(actor, proposal!.token)).toEqual(first);
    expect(
      await db.auditLog.count({
        where: { action: 'intelligence.squire.action', entityId: mine.id },
      })
    ).toBe(1);
    const incident = await db.incident.findUniqueOrThrow({ where: { id: mine.id } });
    if (action === 'resolve_incident') expect(incident.status).toBe('RESOLVED');
    if (action === 'reassign_incident') expect(incident.assigneeId).toBe(outsider.id);
    if (action === 'link_related_incident')
      expect(await db.incidentRelationship.count({ where: { type: 'RELATED' } })).toBe(1);
  }
);

it('refuses a stale reassignment rather than overwriting a newer human assignment', async () => {
  await setup();
  const { responder, outsider, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'reassign_incident', {
    incidentId: mine.id,
    assigneeId: outsider.id,
  });
  const { assignIncidentDomainCommand } = await import('@/lib/incidents/assignment');
  await assignIncidentDomainCommand({
    incidentId: mine.id,
    assigneeId: responder.id,
    actor: { id: responder.id, name: responder.name },
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
    ok: false,
    message: expect.stringContaining('changed'),
  });
  expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).assigneeId).toBe(
    responder.id
  );
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'FAILED',
  });
});

it('requires fresh lifecycle review after the escalation generation changes', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'resolve_incident', {
    incidentId: mine.id,
    resolution: 'The service recovered after rollback.',
  });
  await db.incident.update({
    where: { id: mine.id },
    data: { escalationGeneration: { increment: 1 } },
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
    ok: false,
    message: expect.stringContaining('changed'),
  });
  expect((await db.incident.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('OPEN');
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'FAILED',
  });
});

it('does not overwrite a relationship decision made after proposal review', async () => {
  await setup();
  const { responder, mine, theirs } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const { linkIncidents } = await import('@/lib/intelligence/correlation/commands');
  const linked = await linkIncidents(actor, { incidentId: mine.id, otherIncidentId: theirs.id });
  const proposal = await buildProposal(actor, 'link_related_incident', {
    incidentId: mine.id,
    otherIncidentId: theirs.id,
  });
  await db.incidentRelationship.update({
    where: { id: linked.relationshipId },
    data: { decision: 'REJECTED' },
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
    ok: false,
    message: expect.stringContaining('changed'),
  });
  expect(
    (await db.incidentRelationship.findUniqueOrThrow({ where: { id: linked.relationshipId } }))
      .decision
  ).toBe('REJECTED');
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'FAILED',
  });
});

it('keeps a lifecycle success recoverable when its native post-commit refresh throws', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'resolve_incident', {
    incidentId: mine.id,
    resolution: 'Recovered after database failover.',
  });
  vi.mocked(revalidatePath).mockImplementationOnce(() => {
    throw new Error('Lost return after native commit');
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
    ok: true,
    message: 'Incident resolved.',
  });
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'SUCCEEDED',
  });
  expect(
    await db.auditLog.count({ where: { action: 'intelligence.squire.action', entityId: mine.id } })
  ).toBe(1);
});

it.each([
  'acknowledge_incident',
  'resolve_incident',
  'reassign_incident',
  'link_related_incident',
] as const)(
  'rolls back %s and its success receipt together when final audit persistence fails',
  async action => {
    await setup();
    const { responder, outsider, mine, theirs } = await world();
    const actor = await actorOf(responder.id);
    session.userId = responder.id;
    const input =
      action === 'resolve_incident'
        ? { incidentId: mine.id, resolution: 'Recovered after rollback and verified the service.' }
        : action === 'reassign_incident'
          ? { incidentId: mine.id, assigneeId: outsider.id }
          : action === 'link_related_incident'
            ? { incidentId: mine.id, otherIncidentId: theirs.id }
            : { incidentId: mine.id };
    const proposal = await buildProposal(actor, action, input);
    const audit = await import('@/lib/audit');
    const original = audit.logAudit;
    const fault = vi.spyOn(audit, 'logAudit').mockImplementation(async (...args) => {
      if (args[0].action === 'intelligence.squire.action' && args[1])
        throw new Error('Injected failure at final atomic persistence');
      return original(...args);
    });
    try {
      expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: false });
    } finally {
      fault.mockRestore();
    }
    const current = await db.incident.findUniqueOrThrow({ where: { id: mine.id } });
    expect(current.status).toBe('OPEN');
    expect(current.assigneeId).toBeNull();
    expect(await db.incidentRelationship.count({ where: { type: 'RELATED' } })).toBe(0);
    expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
      status: 'UNKNOWN',
    });
    expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({
      ok: false,
      message: expect.stringContaining('unknown'),
    });
  }
);

it('does not begin a command when receipt reservation fails', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'Never started',
  });
  const appDb = (await import('@/lib/prisma')).default;
  const fault = vi
    .spyOn(appDb.squireActionReceipt, 'create')
    .mockRejectedValueOnce(new Error('Reservation unavailable'));
  try {
    await expect(executeSquireAction(actor, proposal!.token)).rejects.toThrow(
      'Reservation unavailable'
    );
  } finally {
    fault.mockRestore();
  }
  expect(await db.incidentNote.count({ where: { incidentId: mine.id } })).toBe(0);
  expect(await db.squireActionReceipt.count({ where: { id: proposal!.receiptId! } })).toBe(0);
});

it('marks an attempt uncertain if it crashes immediately after reservation and never runs its command', async () => {
  await setup();
  const { responder, mine } = await world();
  const actor = await actorOf(responder.id);
  session.userId = responder.id;
  const proposal = await buildProposal(actor, 'add_incident_note', {
    incidentId: mine.id,
    content: 'Reserved only',
  });
  const appDb = (await import('@/lib/prisma')).default;
  const fault = vi
    .spyOn(appDb.squireActionReceipt, 'update')
    .mockRejectedValueOnce(new Error('Executor unavailable'));
  try {
    expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: false });
  } finally {
    fault.mockRestore();
  }
  expect(await db.incidentNote.count({ where: { incidentId: mine.id } })).toBe(0);
  expect(await readSquireActionOutcome(actor, proposal!.receiptId!)).toMatchObject({
    status: 'UNKNOWN',
  });
  expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: false });
  expect(await db.incidentNote.count({ where: { incidentId: mine.id } })).toBe(0);
});
