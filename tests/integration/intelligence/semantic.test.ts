import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import {
  breakers,
  embeddingBreakers,
  invalidateGatewayCache,
  resolveGatewayEmbedding,
} from '@/lib/intelligence/ai/gateway';
import { getAiSettings, saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import {
  claimWorkItems,
  completeWorkItem,
  enqueueWorkItems,
  WORK_KINDS,
} from '@/lib/intelligence/jobs/work-queue';
import { getIntelligenceSettings, publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  currentEmbeddingModel,
  embedIncidents,
  findIncidentsToEmbed,
  getSemanticIndexStatus,
} from '@/lib/intelligence/semantic/embedder';
import { findSimilarIncidents } from '@/lib/intelligence/similarity/retrieval';
import {
  detectCapabilities,
  resetCapabilityCacheForTests,
} from '@/lib/intelligence/similarity/capabilities';
import { ensureAnnIndex, semanticNeighbours } from '@/lib/intelligence/semantic/search';
import { describeReasons } from '@/lib/intelligence/similarity/view';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let model: FakeServer;
beforeAll(async () => {
  model = await startFakeModel();
});
afterAll(async () => {
  await model.close();
});

/** Payment-themed texts share one direction; everything else another. */
const topicVector = (text: string) => {
  const payments = /checkout|payment|purchase|transaction/i.test(text);
  return payments ? [1, 0.05, 0, 0, 0, 0, 0, 0] : [0, 0, 1, 0, 0, 0, 0, 0.05];
};

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  resetCapabilityCacheForTests();
  model.requests.length = 0;
  model.script.length = 0;
  model.embed = topicVector;
  invalidateGatewayCache();
});

const options = { candidateCap: 50, lookbackDays: 30, minScore: 0.3, limit: 5, maxDbMs: 2000 };
const embeddingCalls = () => model.requests.filter(request => request.path.endsWith('/embeddings'));

async function setup(
  overrides: {
    embeddingsEnabled?: boolean;
    maxDataClass?: 'PUBLIC' | 'INTERNAL' | 'PERSONAL';
    embeddingModel?: string | null;
  } = {}
) {
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
      maxOutputTokens: 1024,
      requestTimeoutMs: 10_000,
      allowedDataRegions: [],
      embeddingsEnabled: overrides.embeddingsEnabled ?? true,
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
      maxDataClass: overrides.maxDataClass ?? 'PERSONAL',
      allowPrivateNetwork: true,
      priority: 1,
      embeddingModel: overrides.embeddingModel === undefined ? 'emb-1' : overrides.embeddingModel,
    },
    ctx
  );
  breakers.recordSuccess(provider.id);
  embeddingBreakers.recordSuccess(provider.id);
  invalidateGatewayCache();
  return { admin, ctx, provider };
}

async function indexed(
  title: string,
  serviceId: string,
  createdAt = new Date(Date.now() - 3_600_000)
) {
  const incident = await createTestIncident(title, serviceId, { createdAt });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

describe('semantic similar-incident search', () => {
  it('re-embeds after an endpoint change even when the provider and model alias are unchanged', async () => {
    const { provider } = await setup();
    const service = await createTestService('Embedding identity');
    const incident = await indexed('Checkout unavailable', service.id);
    const original = await currentEmbeddingModel();
    await embedIncidents([incident.id]);
    expect(await findIncidentsToEmbed(original!)).toEqual([]);

    await db.aiProvider.update({
      where: { id: provider.id },
      data: { baseUrl: `${model.url}/alternate` },
    });
    invalidateGatewayCache();
    const replacement = await currentEmbeddingModel();
    expect(replacement).not.toBe(original);
    expect(await findIncidentsToEmbed(replacement!)).toEqual([incident.id]);
    expect(await getSemanticIndexStatus()).toMatchObject({ indexed: 0, pending: 1 });
    await embedIncidents([incident.id]);
    expect(embeddingCalls()).toHaveLength(2);
    expect(embeddingCalls()[1].path).toContain('/alternate/');
    expect(embeddingCalls()[1].body.model).toBe('emb-1');
    expect(await getSemanticIndexStatus()).toMatchObject({ indexed: 1, pending: 0 });
  });

  it('does not invalidate vectors for display-only edits, but separates another provider', async () => {
    const { provider } = await setup();
    const original = await currentEmbeddingModel();
    await db.aiProvider.update({
      where: { id: provider.id },
      data: { name: 'Renamed', priority: 2 },
    });
    invalidateGatewayCache();
    expect(await currentEmbeddingModel()).toBe(original);
    await db.aiProvider.update({ where: { id: provider.id }, data: { enabled: false } });
    const row = await db.aiProvider.findUniqueOrThrow({ where: { id: provider.id } });
    await db.aiProvider.create({
      data: { ...row, id: undefined, options: {}, name: 'Replacement', enabled: true },
    });
    invalidateGatewayCache();
    expect(await currentEmbeddingModel()).not.toBe(original);
  });

  it('finds a paraphrase that wording alone misses, and explains it as a meaning match', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const billing = await createTestService('Billing');
    const target = await indexed('Checkout payments failing for customers 4815162342', shop.id);
    const paraphrase = await indexed('Purchase transactions declined at gateway', billing.id);
    const unrelated = await indexed('Disk usage high on worker node', billing.id);

    const lexicalOnly = await findSimilarIncidents(target.id, options);
    expect(lexicalOnly!.results.map(r => r.incidentId)).not.toContain(paraphrase.id);

    const semanticModel = await currentEmbeddingModel();
    expect(semanticModel).toMatch(/^embedding:v1:[a-f0-9]{64}$/);
    const outcome = await embedIncidents([target.id, paraphrase.id, unrelated.id]);
    expect(outcome).toMatchObject({ status: 'done', model: semanticModel });
    expect(embeddingCalls()).toHaveLength(1);
    // Numeric identifiers are masked; remaining text still requires Personal clearance.
    const sent = JSON.stringify(embeddingCalls()[0].body.input);
    expect(sent).toContain('checkout payments failing for customers');
    expect(sent).not.toContain('4815162342');

    const stored = await db.incidentEmbedding.findUniqueOrThrow({
      where: { incidentId: target.id },
    });
    expect(stored.dims).toBe(8);
    expect(stored.vector.reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1, 4);

    const semantic = await findSimilarIncidents(target.id, { ...options, semanticModel });
    const match = semantic!.results.find(r => r.incidentId === paraphrase.id);
    expect(match).toBeDefined();
    expect(match!.components.semantic).toBeGreaterThan(0.99);
    expect(describeReasons(match!.components)).toContain('Similar meaning');
    expect(semantic!.results.map(r => r.incidentId)).not.toContain(unrelated.id);
  });

  it('ignores vectors from another model, so a model change can never mix incomparable vectors', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const target = await indexed('Checkout payments failing', shop.id);
    const paraphrase = await indexed('Purchase transactions declined', shop.id);
    await embedIncidents([target.id, paraphrase.id]);
    const result = await findSimilarIncidents(target.id, {
      ...options,
      semanticModel: 'OPENAI_COMPATIBLE:other',
    });
    expect(
      result!.results.find(r => r.incidentId === paraphrase.id)?.components.semantic
    ).toBeUndefined();
    expect(await findIncidentsToEmbed('OPENAI_COMPATIBLE:other')).toHaveLength(2);
  });

  it('skips unchanged incidents and re-embeds only when the title changes', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const incident = await indexed('Checkout payments failing', shop.id);
    await embedIncidents([incident.id]);
    expect(await findIncidentsToEmbed((await currentEmbeddingModel())!)).toEqual([]);
    expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [] });
    expect(embeddingCalls()).toHaveLength(1);

    await db.incident.update({
      where: { id: incident.id },
      data: { title: 'Checkout payment latency high' },
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    expect(await findIncidentsToEmbed((await currentEmbeddingModel())!)).toEqual([incident.id]);
    expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [incident.id] });
  });

  it('runs as one batched background pass that re-queues analysis for what it embedded', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const incidents = await Promise.all(
      ['Checkout down', 'Payments slow', 'Disk full'].map(title => indexed(title, shop.id))
    );
    const handler = DEFAULT_HANDLERS[WORK_KINDS.EMBED_PENDING]!;
    await handler(
      {
        id: 'w',
        kind: WORK_KINDS.EMBED_PENDING,
        subjectKey: 'pending',
        generation: 1,
        claimToken: 't',
        attempts: 1,
      },
      {
        settings: { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 } as never,
        signal: new AbortController().signal,
      }
    );
    expect(embeddingCalls()).toHaveLength(1);
    const queued = await db.intelligenceWorkItem.findMany({
      where: { kind: WORK_KINDS.ANALYZE_INCIDENT },
    });
    expect(queued.map(item => item.subjectKey).sort()).toEqual(incidents.map(i => i.id).sort());
    const status = await getSemanticIndexStatus();
    expect(status).toEqual({
      model: (await currentEmbeddingModel())!,
      modelLabel: 'emb-1',
      indexed: 3,
      pending: 0,
    });
  });

  it('records text the provider cannot embed without a vector, so it never blocks newer incidents', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const older = await indexed(
      'Unembeddable title',
      shop.id,
      new Date(Date.now() - 2 * 3_600_000)
    );
    const newer = await indexed('Checkout payments failing', shop.id);
    model.embed = text =>
      /unembeddable/i.test(text) ? [0, 0, 0, 0, 0, 0, 0, 0] : topicVector(text);

    expect(await embedIncidents([older.id, newer.id])).toMatchObject({ embedded: [newer.id] });
    const marker = await db.$queryRaw<Array<{ vector: number[] | null }>>`
      SELECT "vector" FROM "IncidentEmbedding" WHERE "incidentId" = ${older.id}`;
    expect(marker[0].vector).toBeNull();
    expect(await findIncidentsToEmbed((await currentEmbeddingModel())!)).toEqual([]);
    expect(
      (
        await semanticNeighbours(older.id, {
          model: (await currentEmbeddingModel())!,
          lowerBound: new Date(0),
          limit: 5,
          scanLimit: 50,
          alsoScore: [newer.id],
          maxDbMs: 2000,
        })
      ).size
    ).toBe(0);
    expect(await getSemanticIndexStatus()).toMatchObject({ indexed: 1, pending: 0 });
  });

  it("scans the incident's own service first, so a busy install does not hide an older same-service precedent", async () => {
    await setup();
    const shop = await createTestService('Shop');
    const other = await createTestService('Other');
    const precedent = await indexed(
      'Purchase transactions declined',
      shop.id,
      new Date(Date.now() - 5 * 86_400_000)
    );
    const noise = [];
    for (let i = 0; i < 6; i += 1)
      noise.push(await indexed(`Disk usage high on node ${i}`, other.id));
    const target = await indexed('Checkout payments failing', shop.id);
    await embedIncidents([precedent.id, target.id, ...noise.map(n => n.id)]);

    const scores = await semanticNeighbours(target.id, {
      model: (await currentEmbeddingModel())!,
      lowerBound: new Date(Date.now() - 30 * 86_400_000),
      limit: 3,
      scanLimit: 3,
      alsoScore: [],
      maxDbMs: 2000,
    });
    expect(scores.get(precedent.id)).toBeGreaterThan(0.99);
  });

  it('uses an approximate nearest-neighbour index when pgvector is installed', async () => {
    resetCapabilityCacheForTests();
    if (!(await detectCapabilities()).vectorAvailable) return; // exercised on databases that ship pgvector
    await setup();
    const shop = await createTestService('Shop');
    const target = await indexed('Checkout payments failing', shop.id);
    const paraphrase = await indexed('Purchase transactions declined', shop.id);
    const unrelated = await indexed('Disk usage high on worker node', shop.id);
    await embedIncidents([target.id, paraphrase.id, unrelated.id]);
    await ensureAnnIndex(8);
    const index = await db.$queryRaw<Array<{ valid: boolean }>>`
      SELECT i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = 'idx_incident_embedding_hnsw_8'`;
    expect(index[0]?.valid).toBe(true);

    const scores = await semanticNeighbours(target.id, {
      model: (await currentEmbeddingModel())!,
      lowerBound: new Date(0),
      limit: 1,
      scanLimit: 1,
      alsoScore: [],
      maxDbMs: 2000,
    });
    expect([...scores.keys()]).toEqual([paraphrase.id]);
    expect(scores.get(paraphrase.id)).toBeGreaterThan(0.99);
  });

  it('is fully off unless enabled, configured with an embedding model, and allowed to receive Personal data', async () => {
    await setup({ embeddingsEnabled: false });
    expect(await currentEmbeddingModel()).toBeNull();
    expect(await embedIncidents(['x'])).toEqual({ status: 'disabled' });
    await resetDatabase();
    invalidateGatewayCache();
    await setup({ maxDataClass: 'PUBLIC' });
    expect(await currentEmbeddingModel()).toBeNull();
    await resetDatabase();
    invalidateGatewayCache();
    await setup({ embeddingModel: null });
    expect(await currentEmbeddingModel()).toBeNull();
    expect(embeddingCalls()).toHaveLength(0);
  });

  it('fails soft: a provider error leaves lexical similarity intact and stores nothing', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const target = await indexed('Checkout payments failing', shop.id);
    const twin = await indexed('Checkout payments failing again', shop.id);
    // The SDK retries once, so both attempts fail.
    model.script.push({ status: 500 }, { status: 500 });
    await expect(embedIncidents([target.id, twin.id])).rejects.toThrow();
    expect(await db.incidentEmbedding.count()).toBe(0);
    const result = await findSimilarIncidents(target.id, {
      ...options,
      semanticModel: await currentEmbeddingModel(),
    });
    expect(result!.results.map(r => r.incidentId)).toContain(twin.id);
  });

  it('deletes vectors with their incident and with fingerprint retention', async () => {
    await setup();
    const shop = await createTestService('Shop');
    const old = await indexed('Checkout old', shop.id, new Date(Date.now() - 40 * 86_400_000));
    const recent = await indexed('Checkout recent', shop.id);
    await embedIncidents([old.id, recent.id]);
    expect(await db.incidentEmbedding.count()).toBe(2);

    const result = await purgeExpiredIntelligenceData(
      { ...INTELLIGENCE_SETTINGS_DEFAULTS, fingerprintRetentionDays: 30 },
      { batchSize: 100 }
    );
    expect(result.embeddings).toBe(1);
    await db.incident.delete({ where: { id: recent.id } });
    expect(await db.incidentEmbedding.count()).toBe(0);
  });
});

it('requires Personal clearance for masked titles that still contain a synthetic person name', async () => {
  const { provider } = await setup({ maxDataClass: 'INTERNAL' });
  const service = await createTestService('Embedding privacy boundary');
  const incident = await indexed(
    'Checkout failure investigated by Alice canarypersonaltext',
    service.id
  );
  const fingerprint = await db.incidentFingerprint.findUniqueOrThrow({
    where: { incidentId: incident.id },
  });
  expect(fingerprint.template).toContain('alice');
  const selected = await currentEmbeddingModel();
  const outcome = await embedIncidents([incident.id]);
  if (embeddingCalls().length)
    expect(JSON.stringify(embeddingCalls()[0].body.input)).toContain('alice');
  expect(embeddingCalls()).toHaveLength(0);
  expect(selected).toBeNull();
  expect(outcome).toEqual({ status: 'disabled' });
  expect((await db.aiProvider.findUniqueOrThrow({ where: { id: provider.id } })).maxDataClass).toBe(
    'INTERNAL'
  );
  await db.aiProvider.update({ where: { id: provider.id }, data: { maxDataClass: 'PERSONAL' } });
  invalidateGatewayCache();
  await embedIncidents([incident.id]);
  expect(embeddingCalls()).toHaveLength(1);
  expect(JSON.stringify(embeddingCalls()[0].body.input)).toContain('alice');
});

it('skips OFF services before embedding and honours the Intelligence kill switch', async () => {
  const { ctx } = await setup();
  const activeService = await createTestService('Embedding active service');
  const offService = await createTestService('Embedding OFF service');
  const active = await indexed('Checkout activeembeddingcanary', activeService.id);
  const off = await indexed('Checkout offembeddingcanary', offService.id);
  await publishPolicyVersion(
    { serviceId: offService.id },
    { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    ctx
  );
  const result = await embedIncidents([off.id, active.id]);
  expect(JSON.stringify(embeddingCalls())).not.toContain('offembeddingcanary');
  expect(result).toMatchObject({ status: 'done', embedded: [active.id] });
  expect(await db.incidentEmbedding.findUnique({ where: { incidentId: off.id } })).toBeNull();
  const waiting = await indexed('Checkout globallyblockedcanary', activeService.id);
  model.requests.length = 0;
  await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
  expect(await currentEmbeddingModel()).toBeNull();
  expect(await embedIncidents([waiting.id])).toEqual({ status: 'disabled' });
  expect(embeddingCalls()).toHaveLength(0);
});

it('filters OFF-service candidates before the pending batch limit', async () => {
  const { ctx } = await setup();
  const activeService = await createTestService('Older eligible embedding source');
  const offService = await createTestService('Newer disabled embedding sources');
  const active = await indexed(
    'Checkout eligible source',
    activeService.id,
    new Date(Date.now() - 7_200_000)
  );
  const disabled: Array<Awaited<ReturnType<typeof indexed>>> = [];
  for (let index = 0; index < 33; index++)
    disabled.push(await indexed(`Checkout disabled source ${index}`, offService.id));
  await publishPolicyVersion(
    { serviceId: offService.id },
    { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    ctx
  );
  const pending = await findIncidentsToEmbed((await currentEmbeddingModel())!);
  expect(pending).toContain(active.id);
  expect(pending.some(id => disabled.some(incident => incident.id === id))).toBe(false);
});

it('queues stale source text for native reindexing before sending it to an embedding provider', async () => {
  await setup();
  const service = await createTestService('Embedding source freshness');
  const incident = await indexed('Checkout oldpersonalcanary', service.id);
  await db.incident.update({
    where: { id: incident.id },
    data: { title: 'Checkout revised facts' },
  });
  expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [] });
  expect(embeddingCalls()).toHaveLength(0);
  expect(
    await db.intelligenceWorkItem.findUnique({
      where: { kind_subjectKey: { kind: 'INDEX_INCIDENT', subjectKey: incident.id } },
    })
  ).not.toBeNull();
  await db.$transaction(tx => indexIncident(incident.id, tx));
  await embedIncidents([incident.id]);
  expect(embeddingCalls()).toHaveLength(1);
  expect(JSON.stringify(embeddingCalls()[0].body.input)).not.toContain('oldpersonalcanary');
});

it('discards an embedding response when its service was switched OFF during the request', async () => {
  const { ctx } = await setup();
  const service = await createTestService('Embedding in-flight policy change');
  const incident = await indexed('Checkout permission race', service.id);
  await currentEmbeddingModel();
  const ports = await import('@/lib/intelligence/ai/port');
  const real = await ports.resolveEmbeddingModel('PERSONAL');
  if (!real) throw new Error('Expected eligible provider');
  const send = vi.fn(async () => {
    await publishPolicyVersion(
      { serviceId: service.id },
      { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      ctx
    );
    return { vectors: [[1, 0, 0, 0, 0, 0, 0, 0]], tokens: 1 };
  });
  const resolve = vi
    .spyOn(ports, 'resolveEmbeddingModel')
    .mockResolvedValue({ ...real, embed: send });
  try {
    expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.incidentEmbedding.count()).toBe(0);
  } finally {
    resolve.mockRestore();
  }
});

it('uses current service ownership instead of a cached fingerprint service when applying OFF', async () => {
  const { ctx } = await setup();
  const active = await createTestService('Previous embedding owner');
  const off = await createTestService('Current disabled embedding owner');
  const incident = await indexed('Checkout moved source', active.id);
  await publishPolicyVersion(
    { serviceId: off.id },
    { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    ctx
  );
  await db.incident.update({ where: { id: incident.id }, data: { serviceId: off.id } });
  expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [] });
  expect(await findIncidentsToEmbed((await currentEmbeddingModel())!)).not.toContain(incident.id);
  expect(embeddingCalls()).toHaveLength(0);
  expect(await db.intelligenceWorkItem.count()).toBe(0);
});

it('discards an in-flight vector if the embedding endpoint changes before storage', async () => {
  const { provider } = await setup();
  const service = await createTestService('Embedding deployment race');
  const incident = await indexed('Checkout provider race', service.id);
  await currentEmbeddingModel();
  const ports = await import('@/lib/intelligence/ai/port');
  const original = await ports.resolveEmbeddingModel('PERSONAL');
  if (!original) throw new Error('Expected eligible embedding provider');
  const send = vi.fn(async () => {
    await db.aiProvider.update({
      where: { id: provider.id },
      data: { baseUrl: `${model.url}/changed` },
    });
    invalidateGatewayCache();
    return { vectors: [[1, 0, 0, 0, 0, 0, 0, 0]], tokens: 1 };
  });
  const resolve = vi
    .spyOn(ports, 'resolveEmbeddingModel')
    .mockResolvedValueOnce({ ...original, embed: send });
  try {
    expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.incidentEmbedding.count()).toBe(0);
  } finally {
    resolve.mockRestore();
  }
});

it('keeps the embedding space pinned across a circuit outage and recovery', async () => {
  const { provider, ctx } = await setup();
  const backup = await saveAiProvider(
    null,
    {
      name: 'Standby',
      kind: 'OPENAI_COMPATIBLE',
      model: 'm',
      baseUrl: `${model.url}/backup`,
      apiKey: 'k',
      enabled: true,
      isExternal: false,
      maxDataClass: 'PERSONAL',
      allowPrivateNetwork: true,
      priority: 2,
      embeddingModel: 'backup-space',
    },
    ctx
  );
  const shop = await createTestService('Pinned embedding space');
  const original = await indexed('Checkout failing', shop.id);
  const precedent = await indexed('Payment transactions declined', shop.id);
  const pending = await indexed('Checkout newly failing', shop.id);
  await embedIncidents([original.id, precedent.id]);
  const space = await currentEmbeddingModel();
  const before = await db.incidentEmbedding.findMany({ orderBy: { incidentId: 'asc' } });
  const requests = embeddingCalls().length;
  for (let failure = 0; failure < 3; failure++) embeddingBreakers.recordFailure(provider.id);
  try {
    expect(embeddingBreakers.isOpen(provider.id)).toBe(true);
    expect(await currentEmbeddingModel()).toBe(space);
    await expect(embedIncidents([pending.id])).rejects.toThrow('Embedding provider unavailable');
    expect(embeddingCalls()).toHaveLength(requests);
    expect(await db.incidentEmbedding.findMany({ orderBy: { incidentId: 'asc' } })).toEqual(before);
    expect(await getSemanticIndexStatus()).toMatchObject({ indexed: 2, pending: 1 });
    const cached = await findSimilarIncidents(original.id, { ...options, semanticModel: space });
    expect(
      cached?.results.find(row => row.incidentId === precedent.id)?.components.semantic
    ).toBeGreaterThan(0.99);
    embeddingBreakers.recordSuccess(provider.id);
    expect(await embedIncidents([original.id, precedent.id])).toMatchObject({ embedded: [] });
    expect(embeddingCalls()).toHaveLength(requests);
    expect(await embedIncidents([pending.id])).toMatchObject({ embedded: [pending.id] });
    expect(embeddingCalls().at(-1)?.body.model).toBe('emb-1');
    expect(embeddingCalls().some(call => call.path.includes('/backup/'))).toBe(false);
  } finally {
    embeddingBreakers.recordSuccess(provider.id);
    embeddingBreakers.recordSuccess(backup.id);
  }
});

it('pauses a budget-exhausted backfill without provider egress or dead letters and keeps interactive embeddings available', async () => {
  const { admin, ctx } = await setup();
  const shop = await createTestService('Embedding allocation');
  const original = await indexed('Checkout failing', shop.id);
  const precedent = await indexed('Payment transactions declined', shop.id);
  await embedIncidents([original.id, precedent.id]);
  const pending = await indexed('Checkout newly failing', shop.id);
  const space = await currentEmbeddingModel();
  const before = await db.incidentEmbedding.findMany({ orderBy: { incidentId: 'asc' } });
  const day = new Date().toISOString().slice(0, 10);
  await db.aiUsageDay.update({
    where: { day },
    data: { inputTokens: 100000, outputTokens: 0, backgroundEmbeddingTokens: 100000 },
  });
  const requests = embeddingCalls().length;
  const handler = DEFAULT_HANDLERS[WORK_KINDS.EMBED_PENDING]!;
  await expect(
    handler(
      {
        id: 'budget-work',
        kind: WORK_KINDS.EMBED_PENDING,
        subjectKey: 'pending',
        generation: 1,
        claimToken: 'budget-claim',
        attempts: 1,
      },
      { settings: await getIntelligenceSettings(), signal: new AbortController().signal }
    )
  ).resolves.toBeUndefined();
  expect(embeddingCalls()).toHaveLength(requests);
  expect(await currentEmbeddingModel()).toBe(space);
  expect(await db.incidentEmbedding.findMany({ orderBy: { incidentId: 'asc' } })).toEqual(before);
  const cached = await findSimilarIncidents(original.id, { ...options, semanticModel: space });
  expect(
    cached?.results.find(row => row.incidentId === precedent.id)?.components.semantic
  ).toBeGreaterThan(0.99);
  const interactive = await resolveGatewayEmbedding('PERSONAL');
  expect(interactive).not.toBeNull();
  await expect(
    interactive!.embed(['Payment search query'], { actorId: admin.id })
  ).resolves.toMatchObject({ vectors: expect.any(Array) });
  expect(embeddingCalls()).toHaveLength(requests + 1);
  expect(
    (await db.aiUsageDay.findUniqueOrThrow({ where: { day } })).backgroundEmbeddingTokens
  ).toBe(100000);
  const settings = await getAiSettings();
  const { revision, ...values } = settings;
  await updateAiSettings(
    { ...values, backgroundEmbeddingBudgetPercent: 40, expectedRevision: revision },
    ctx
  );
  invalidateGatewayCache();
  expect(await embedIncidents([pending.id])).toMatchObject({ embedded: [pending.id] });
});

it('coalesces a burst of 100 source touches into one index pass without re-embedding unchanged content', async () => {
  await setup();
  const service = await createTestService('Metadata burst service');
  const incident = await indexed('Checkout payment failing', service.id);
  await embedIncidents([incident.id]);
  expect(embeddingCalls()).toHaveLength(1);
  model.requests.length = 0;
  const base = Date.now() - 1000;
  let sourceUpdatedAt = new Date(base);
  for (let i = 0; i < 100; i++) {
    sourceUpdatedAt = new Date(base + i);
    await db.incident.update({ where: { id: incident.id }, data: { updatedAt: sourceUpdatedAt } });
    await enqueueWorkItems([{ kind: WORK_KINDS.INDEX_INCIDENT, subjectKey: incident.id }]);
  }
  expect(await db.intelligenceWorkItem.count()).toBe(1);
  const claimed = await claimWorkItems({ limit: 10 });
  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({ kind: WORK_KINDS.INDEX_INCIDENT, subjectKey: incident.id });
  await DEFAULT_HANDLERS[WORK_KINDS.INDEX_INCIDENT]!(claimed[0], {
    settings: await getIntelligenceSettings(),
    signal: new AbortController().signal,
  });
  expect(await completeWorkItem(claimed[0])).toBe('completed');
  const fingerprint = await db.incidentFingerprint.findUniqueOrThrow({
    where: { incidentId: incident.id },
  });
  expect(fingerprint.sourceUpdatedAt).toEqual(sourceUpdatedAt);
  // Freshness still advances and each enabled analysis kind is signalled once.
  const followups = await db.intelligenceWorkItem.findMany({ select: { kind: true } });
  expect(followups.map(item => item.kind).sort()).toEqual([
    WORK_KINDS.ANALYZE_INCIDENT,
    WORK_KINDS.ANALYZE_RESPONSE,
  ]);
  const space = await currentEmbeddingModel();
  expect(space).not.toBeNull();
  expect(await findIncidentsToEmbed(space!)).toEqual([]);
  await embedIncidents([incident.id]);
  expect(embeddingCalls()).toHaveLength(0);
});
