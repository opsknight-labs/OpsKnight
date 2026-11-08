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
import { breakers, embeddingBreakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { registerEmbeddingResolver } from '@/lib/intelligence/ai/port';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { claimWorkItems, WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import { listServiceFacts, removeServiceFact } from '@/lib/intelligence/memory/facts';
import {
  resetSquireMemorySchedule,
  scheduleSquireMemoryWork,
} from '@/lib/intelligence/memory/handlers';
import { searchKnowledgeForActor } from '@/lib/intelligence/memory/search';
import { updateSquireMemorySettings } from '@/lib/intelligence/memory/settings';
import { embedPendingChunks, syncKnowledgePass } from '@/lib/intelligence/memory/sync';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { buildProposal } from '@/lib/intelligence/squire/actions/proposals';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { SquireEvidenceRegistry } from '@/lib/intelligence/squire/evidence';
import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import { getIntelligenceSettings, publishPolicyVersion } from '@/lib/intelligence/settings/service';
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
  resetSquireMemorySchedule();
  invalidateGatewayCache();
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

const HOUR = 3_600_000;
const past = (ms: number) => new Date(Date.now() - ms);
/** Sync "now" far enough ahead that every row created by the test has settled. */
const later = () => ({ now: new Date(Date.now() + 120_000) });

async function setup(options: { knowledge?: boolean; ai?: boolean; embeddings?: boolean } = {}) {
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
  if (options.knowledge !== false)
    await updateSquireMemorySettings({ knowledgeEnabled: true, expectedRevision: 0 }, admin.id);
  if (options.ai) {
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
        embeddingsEnabled: options.embeddings ?? false,
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
        maxDataClass: 'PERSONAL',
        allowPrivateNetwork: true,
        priority: 1,
        ...(options.embeddings ? { embeddingModel: 'emb-1' } : {}),
      },
      ctx
    );
    breakers.recordSuccess(provider.id);
    embeddingBreakers.recordSuccess(provider.id);
    invalidateGatewayCache();
  }
  return { admin, ctx };
}

async function budget() {
  const settings = await getIntelligenceSettings();
  return { maxDbMs: 5_000, fingerprintRetentionDays: settings.fingerprintRetentionDays };
}

async function publishedRunbook(
  name: string,
  steps: Array<{ name: string; description?: string }>
) {
  const runbook = await db.runbook.create({
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}` },
  });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      checksum: 'c',
      definition: {
        steps: steps.map((step, index) => ({
          key: `s${index}`,
          type: 'HTTP',
          config: { url: 'https://internal.example/secret-path', token: 'never-indexed' },
          ...step,
        })),
      },
    },
  });
  return db.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id, updatedAt: past(HOUR) },
  });
}

async function world() {
  const teamA = await createTestTeam('Team A');
  const teamB = await createTestTeam('Team B');
  const serviceA = await createTestService('Cache A', teamA.id);
  const serviceB = await createTestService('Cache B', teamB.id);
  const memberA = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: memberA.id, teamId: teamA.id, role: 'MEMBER' } });
  const memberB = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: memberB.id, teamId: teamB.id, role: 'MEMBER' } });
  const incidentA = await createTestIncident('Redis eviction storm', serviceA.id, {
    teamId: teamA.id,
    createdAt: past(2 * HOUR),
  });
  const incidentB = await createTestIncident('Redis eviction on payroll', serviceB.id, {
    teamId: teamB.id,
    createdAt: past(2 * HOUR),
    visibility: 'PRIVATE',
  });
  const noteA = await db.incidentNote.create({
    data: {
      incidentId: incidentA.id,
      userId: memberA.id,
      content:
        'Redis eviction caused by maxmemory policy; raised maxmemory to 8gb and it recovered.',
      createdAt: past(HOUR),
    },
  });
  const noteB = await db.incidentNote.create({
    data: {
      incidentId: incidentB.id,
      userId: memberB.id,
      content: 'Payroll redis eviction: flushed the stale keys, token=abcdef0123456789 used.',
      createdAt: past(HOUR),
    },
  });
  return { teamA, teamB, serviceA, serviceB, memberA, memberB, incidentA, incidentB, noteA, noteB };
}

describe('knowledge sync', () => {
  it('indexes every source kind, is idempotent, follows updates and deletes, and never stores secrets', async () => {
    await setup();
    const w = await world();
    const postmortem = await db.postmortem.create({
      data: {
        incidentId: w.incidentA.id,
        title: 'Redis eviction postmortem',
        summary: 'Evictions spiked under load.',
        rootCause: 'maxmemory too low',
        resolution: 'Raised maxmemory',
        updatedAt: past(HOUR),
      },
    });
    const resolved = await createTestIncident('Disk full on cache', w.serviceA.id, {
      teamId: w.teamA.id,
      status: 'RESOLVED',
      createdAt: past(3 * HOUR),
      resolvedAt: past(HOUR),
    });
    await db.incidentEvent.create({
      data: {
        incidentId: resolved.id,
        type: 'MANUAL_RESOLVED',
        message: 'Resolved: cleaned old snapshots from /var/lib/cache',
        createdAt: past(HOUR),
      },
    });
    const runbook = await publishedRunbook('Recover cache', [
      { name: 'Drain traffic', description: 'Move traffic to the standby cluster' },
      { name: 'Restart redis' },
    ]);

    const first = await syncKnowledgePass(await budget(), later());
    expect(first.scanned).toMatchObject({
      POSTMORTEM: 1,
      INCIDENT_NOTE: 2,
      RESOLUTION_NOTE: 1,
      RUNBOOK_STEP: 1,
    });
    const chunks = await db.knowledgeChunk.findMany({ orderBy: { sourceKind: 'asc' } });
    expect(chunks.map(chunk => chunk.sourceKind).sort()).toEqual([
      'INCIDENT_NOTE',
      'INCIDENT_NOTE',
      'POSTMORTEM',
      'RESOLUTION_NOTE',
      'RUNBOOK_STEP',
      'RUNBOOK_STEP',
    ]);
    expect(JSON.stringify(chunks)).not.toMatch(/abcdef0123456789|never-indexed|secret-path/);
    const noteChunk = chunks.find(chunk => chunk.incidentNoteId === w.noteA.id)!;
    expect(noteChunk).toMatchObject({
      serviceId: w.serviceA.id,
      teamId: w.teamA.id,
      incidentId: w.incidentA.id,
    });
    expect(chunks.find(chunk => chunk.postmortemId === postmortem.id)?.text).toMatch(
      /Root cause: maxmemory too low/
    );

    // Idempotent: nothing changed, nothing rewritten (the cursors moved past every source).
    const before = await db.knowledgeChunk.findMany({ select: { id: true, updatedAt: true } });
    const second = await syncKnowledgePass(await budget(), later());
    expect(second.written).toBe(0);
    expect(await db.knowledgeChunk.findMany({ select: { id: true, updatedAt: true } })).toEqual(
      before
    );

    // An edited postmortem is re-indexed in place, with its vector invalidated.
    await db.postmortem.update({
      where: { id: postmortem.id },
      data: { resolution: 'Moved the cache to a larger instance class' },
    });
    const third = await syncKnowledgePass(await budget(), later());
    expect(third.written).toBe(1);
    const updated = await db.knowledgeChunk.findFirstOrThrow({
      where: { postmortemId: postmortem.id },
    });
    expect(updated.text).toMatch(/larger instance class/);
    expect(updated.embeddingModel).toBeNull();
    expect(await db.knowledgeChunk.count({ where: { postmortemId: postmortem.id } })).toBe(1);

    // Deleting a source removes its knowledge at once (cascade); archiving a runbook on the next pass.
    await db.incidentNote.delete({ where: { id: w.noteA.id } });
    expect(await db.knowledgeChunk.count({ where: { incidentNoteId: w.noteA.id } })).toBe(0);
    await db.runbook.update({ where: { id: runbook.id }, data: { archivedAt: new Date() } });
    await syncKnowledgePass(await budget(), later());
    expect(await db.knowledgeChunk.count({ where: { runbookId: runbook.id } })).toBe(0);
  });

  it('keeps nothing for a service whose intelligence policy is OFF and prunes what it had', async () => {
    const { admin } = await setup();
    const w = await world();
    await syncKnowledgePass(await budget(), later());
    expect(await db.knowledgeChunk.count({ where: { serviceId: w.serviceA.id } })).toBe(1);
    await publishPolicyVersion(
      { serviceId: w.serviceA.id },
      { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const pass = await syncKnowledgePass(await budget(), later());
    expect(pass.pruned).toBe(1);
    expect(await db.knowledgeChunk.count({ where: { serviceId: w.serviceA.id } })).toBe(0);
    expect(await db.knowledgeChunk.count({ where: { serviceId: w.serviceB.id } })).toBe(1);
  });

  it('follows fingerprint retention, and removes all derived knowledge while switched off', async () => {
    const { admin } = await setup();
    const w = await world();
    await syncKnowledgePass(await budget(), later());
    const settings = await getIntelligenceSettings();
    // Expire incident A's knowledge: its incident is older than the fingerprint retention.
    await db.knowledgeChunk.updateMany({
      where: { incidentId: w.incidentA.id },
      data: { sourceCreatedAt: past((settings.fingerprintRetentionDays + 1) * 24 * HOUR) },
    });
    const sweep = await purgeExpiredIntelligenceData(settings, { batchSize: 100 });
    expect(sweep.knowledgeChunks).toBe(1);
    expect(await db.knowledgeChunk.count({ where: { incidentId: w.incidentA.id } })).toBe(0);
    expect(await db.knowledgeChunk.count()).toBe(1);

    // An old incident is never re-indexed by the sync either.
    const old = await createTestIncident('Ancient cache issue', w.serviceA.id, {
      createdAt: past((settings.fingerprintRetentionDays + 2) * 24 * HOUR),
    });
    await db.incidentNote.create({
      data: {
        incidentId: old.id,
        content: 'Something long enough to be knowledge here.',
        createdAt: past(HOUR),
      },
    });
    await syncKnowledgePass(await budget(), later());
    expect(await db.knowledgeChunk.count({ where: { incidentId: old.id } })).toBe(0);

    await updateSquireMemorySettings({ knowledgeEnabled: false, expectedRevision: 1 }, admin.id);
    await db.intelligenceCursor.deleteMany({ where: { name: 'intelligence-retention-lease' } });
    await purgeExpiredIntelligenceData(settings, { batchSize: 100 });
    expect(await db.knowledgeChunk.count()).toBe(0);
  });

  it('is scheduled only while switched on, through the lane, and drains in bounded passes', async () => {
    const { admin } = await setup({ knowledge: false });
    await world();
    await scheduleSquireMemoryWork(Date.now(), DEFAULT_HANDLERS);
    expect(await db.intelligenceWorkItem.count()).toBe(0);

    await updateSquireMemorySettings({ knowledgeEnabled: true, expectedRevision: 0 }, admin.id);
    resetSquireMemorySchedule();
    await scheduleSquireMemoryWork(Date.now(), DEFAULT_HANDLERS);
    const [item] = await claimWorkItems({ limit: 5 });
    expect(item).toMatchObject({ kind: WORK_KINDS.SYNC_KNOWLEDGE, subjectKey: 'knowledge' });
    const settings = await getIntelligenceSettings();
    await DEFAULT_HANDLERS[WORK_KINDS.SYNC_KNOWLEDGE]!(item, {
      settings,
      signal: new AbortController().signal,
    });
    // The notes are only an hour old, so they are past the settle window and indexed in the lane.
    expect(await db.knowledgeChunk.count()).toBe(2);
  });

  it('embeds chunks through the configured provider in the same pass, once', async () => {
    await setup({ ai: true, embeddings: true });
    await world();
    const pass = await syncKnowledgePass(await budget(), later());
    expect(pass.embedded).toBe(2);
    const embeddings = model.requests.filter(request => request.path.endsWith('/embeddings'));
    expect(embeddings).toHaveLength(1);
    expect(JSON.stringify(embeddings[0].body.input)).not.toContain('abcdef0123456789');
    const rows = await db.knowledgeChunk.findMany();
    expect(rows.every(row => row.embeddingModel && row.embedding.length === 16)).toBe(true);
    // Nothing left to embed: no further provider calls.
    const calls = model.requests.length;
    expect((await embedPendingChunks({ maxDbMs: 5_000 })).embedded).toBe(0);
    expect(model.requests.length).toBe(calls);
  });
});

describe('knowledge search', () => {
  it('returns only what the reader may read, with a citable source for every passage', async () => {
    const { admin } = await setup();
    const w = await world();
    const runbook = await publishedRunbook('Redis eviction recovery', [
      { name: 'Raise maxmemory', description: 'Redis eviction relief' },
    ]);
    await syncKnowledgePass(await budget(), later());

    const mine = await searchKnowledgeForActor(await actorOf(w.memberA.id), {
      query: 'redis eviction',
      personal: true,
    });
    expect(mine.coverage).toBe('LEXICAL');
    expect(mine.items.map(item => item.source)).toEqual([
      { kind: 'incident', id: w.incidentA.id, href: `/incidents/${w.incidentA.id}` },
    ]);
    expect(JSON.stringify(mine)).not.toContain(w.incidentB.id);

    const everything = await searchKnowledgeForActor(await actorOf(admin.id), {
      query: 'redis eviction',
      personal: true,
    });
    expect(everything.items.map(item => item.source.id).sort()).toEqual(
      [w.incidentA.id, w.incidentB.id, runbook.id].sort()
    );
    // Stored text was already redacted; output is redacted again on the way out.
    expect(JSON.stringify(everything)).not.toContain('abcdef0123456789');

    // Without Personal clearance only operational knowledge is searched.
    const internal = await searchKnowledgeForActor(await actorOf(admin.id), {
      query: 'redis eviction',
      personal: false,
    });
    expect(internal.items.map(item => item.kind)).toEqual(['RUNBOOK_STEP']);

    // Typos fall back to trigram similarity.
    const typo = await searchKnowledgeForActor(await actorOf(w.memberA.id), {
      query: 'maxmemroy',
      personal: true,
    });
    expect(typo.items.map(item => item.source.id)).toContain(w.incidentA.id);
  });

  it('re-ranks semantically only when embeddings are configured, and reports off when switched off', async () => {
    const { admin } = await setup();
    const w = await world();
    await syncKnowledgePass(await budget(), later());
    const vector = (x: number) => [x, 1 - x, 0, 0, 0, 0, 0, 0];
    await db.knowledgeChunk.updateMany({
      where: { incidentId: w.incidentA.id },
      data: { embedding: vector(1), embeddingModel: 'test-emb' },
    });
    await db.knowledgeChunk.updateMany({
      where: { incidentId: w.incidentB.id },
      data: { embedding: vector(0), embeddingModel: 'test-emb' },
    });
    registerEmbeddingResolver(async () => ({
      model: 'test-emb',
      providerId: 'test',
      embed: async () => ({ vectors: [vector(0)], tokens: 1 }),
    }));
    try {
      const result = await searchKnowledgeForActor(await actorOf(admin.id), {
        query: 'redis eviction',
        personal: true,
      });
      expect(result.coverage).toBe('SEMANTIC');
      expect(result.items[0].source.id).toBe(w.incidentB.id);
    } finally {
      registerEmbeddingResolver(async () => null);
    }

    await updateSquireMemorySettings({ knowledgeEnabled: false, expectedRevision: 1 }, admin.id);
    expect(
      await searchKnowledgeForActor(await actorOf(admin.id), { query: 'redis', personal: true })
    ).toEqual({ items: [], coverage: 'OFF' });
  });

  it('is offered to the model only while on, and every result becomes verified evidence', async () => {
    const { admin } = await setup();
    const w = await world();
    await syncKnowledgePass(await budget(), later());
    const actor = await actorOf(w.memberA.id);
    expect(buildSquireTools(actor, { personal: true }).map(tool => tool.name)).not.toContain(
      'search_knowledge'
    );
    const tools = buildSquireTools(actor, { personal: true, knowledge: true });
    expect(tools.map(tool => tool.name)).toEqual(
      expect.arrayContaining(['search_knowledge', 'propose_learn_service_fact'])
    );
    const search = tools.find(tool => tool.name === 'search_knowledge')!;
    expect(search.dataClass).toBe('PERSONAL');
    const result = await search.execute!({ query: 'redis eviction' });
    const registry = new SquireEvidenceRegistry(actor, 'PERSONAL');
    const observed = (await registry.observe(
      'search_knowledge',
      { query: 'redis eviction' },
      result
    )) as {
      evidence?: Array<{ kind: string; id: string }>;
    };
    expect(observed.evidence?.map(source => [source.kind, source.id])).toEqual([
      ['incident', w.incidentA.id],
    ]);
    expect(registry.verified).toBe(true);
    expect(admin.id).toBeTruthy();
  });
});

const proposalsOf = (events: SquireEvent[]) =>
  events
    .filter((e): e is Extract<SquireEvent, { type: 'proposal' }> => e.type === 'proposal')
    .map(e => e.proposal);

describe('learned service facts', () => {
  it('become knowledge only after a curator confirms, once, and can be removed', async () => {
    const { admin } = await setup({ ai: true });
    const w = await world();
    const responder = await createTestUser({ role: 'RESPONDER' });
    const fact = 'Cache A failover takes about four minutes; wait before restarting pods.';

    // The model can only propose; the card names the service and nothing is stored yet.
    model.script.push(
      {
        toolCall: {
          name: 'propose_learn_service_fact',
          args: JSON.stringify({ incidentId: w.incidentA.id, fact }),
        },
      },
      { content: 'I suggested remembering that.' }
    );
    const events: SquireEvent[] = [];
    for await (const event of streamSquire(await actorOf(responder.id), {
      message: 'remember how failover works',
      history: [],
      incidentId: w.incidentA.id,
    }))
      events.push(event);
    const [proposal] = proposalsOf(events);
    expect(proposal).toMatchObject({
      action: 'learn_service_fact',
      kind: 'WRITE',
      title: 'Remember a fact about this service',
    });
    expect(proposal.detail).toContain(fact);
    expect(await db.knowledgeChunk.count({ where: { sourceKind: 'SERVICE_FACT' } })).toBe(0);

    session.userId = responder.id;
    expect(await executeSquireAction(await actorOf(responder.id), proposal.token)).toMatchObject({
      ok: true,
      message: 'Saved to Squire’s knowledge for this service.',
    });
    // A replayed confirmation stores nothing twice.
    expect(await executeSquireAction(await actorOf(responder.id), proposal.token)).toMatchObject({
      ok: true,
    });
    const stored = await db.knowledgeChunk.findMany({ where: { sourceKind: 'SERVICE_FACT' } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      serviceId: w.serviceA.id,
      approvedById: responder.id,
      text: fact,
    });
    expect(
      await db.auditLog.count({ where: { action: 'intelligence.squire.fact.approved' } })
    ).toBe(1);

    // The team member can see and search it; it is cited as the service.
    const facts = await listServiceFacts(await actorOf(w.memberA.id), w.serviceA.id);
    expect(facts?.map(row => row.text)).toEqual([fact]);
    const found = await searchKnowledgeForActor(await actorOf(w.memberA.id), {
      query: 'failover restarting',
      personal: false,
    });
    expect(found.items[0]).toMatchObject({
      kind: 'SERVICE_FACT',
      source: { kind: 'service', id: w.serviceA.id },
    });
    // Another team can neither list nor find it.
    expect(await listServiceFacts(await actorOf(w.memberB.id), w.serviceA.id)).toBeNull();
    expect(
      (
        await searchKnowledgeForActor(await actorOf(w.memberB.id), {
          query: 'failover restarting',
          personal: false,
        })
      ).items
    ).toEqual([]);

    await expect(
      removeServiceFact(await actorOf(w.memberB.id), {
        serviceId: w.serviceA.id,
        factId: stored[0].id,
      })
    ).rejects.toThrow();
    expect(
      await removeServiceFact(await actorOf(admin.id), {
        serviceId: w.serviceA.id,
        factId: stored[0].id,
      })
    ).toBe(true);
    expect(await db.knowledgeChunk.count({ where: { sourceKind: 'SERVICE_FACT' } })).toBe(0);
  });

  it('is never proposed to people who cannot curate, nor with secrets, nor while the index is off', async () => {
    const { admin } = await setup();
    const w = await world();
    const auditor = await createTestUser({ role: 'AUDITOR' });
    const fact = 'Cache A failover takes about four minutes; wait before restarting pods.';
    expect(
      await buildProposal(await actorOf(auditor.id), 'learn_service_fact', {
        incidentId: w.incidentA.id,
        fact,
      })
    ).toBeNull();
    expect(
      await buildProposal(await actorOf(admin.id), 'learn_service_fact', {
        incidentId: w.incidentA.id,
        fact: 'The admin password=supersecret123 always works here',
      })
    ).toBeNull();
    // A team member with feedback rights may curate their own team's service.
    const proposal = await buildProposal(await actorOf(w.memberA.id), 'learn_service_fact', {
      incidentId: w.incidentA.id,
      fact,
    });
    expect(proposal).not.toBeNull();

    // Switched off between proposal and confirmation: the confirmation re-checks and stores nothing.
    await updateSquireMemorySettings({ knowledgeEnabled: false, expectedRevision: 1 }, admin.id);
    session.userId = w.memberA.id;
    expect(await executeSquireAction(await actorOf(w.memberA.id), proposal!.token)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/turned off/),
    });
    expect(await db.knowledgeChunk.count({ where: { sourceKind: 'SERVICE_FACT' } })).toBe(0);
    expect(
      await buildProposal(await actorOf(w.memberA.id), 'learn_service_fact', {
        incidentId: w.incidentA.id,
        fact,
      })
    ).toBeNull();
  });
});
