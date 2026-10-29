import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { breakers, embeddingBreakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
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
    maxDataClass?: 'PUBLIC' | 'INTERNAL';
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
      maxDataClass: overrides.maxDataClass ?? 'INTERNAL',
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
    expect(semanticModel).toBe('OPENAI_COMPATIBLE:emb-1');
    const outcome = await embedIncidents([target.id, paraphrase.id, unrelated.id]);
    expect(outcome).toMatchObject({ status: 'done', model: semanticModel });
    expect(embeddingCalls()).toHaveLength(1);
    // Only masked templates leave the system: numbers and identifiers never reach the provider.
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
    expect(await findIncidentsToEmbed('OPENAI_COMPATIBLE:emb-1')).toEqual([]);
    expect(await embedIncidents([incident.id])).toMatchObject({ embedded: [] });
    expect(embeddingCalls()).toHaveLength(1);

    await db.incident.update({
      where: { id: incident.id },
      data: { title: 'Checkout payment latency high' },
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    expect(await findIncidentsToEmbed('OPENAI_COMPATIBLE:emb-1')).toEqual([incident.id]);
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
    expect(status).toEqual({ model: 'OPENAI_COMPATIBLE:emb-1', indexed: 3, pending: 0 });
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
    expect(await findIncidentsToEmbed('OPENAI_COMPATIBLE:emb-1')).toEqual([]);
    expect(
      (
        await semanticNeighbours(older.id, {
          model: 'OPENAI_COMPATIBLE:emb-1',
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
      model: 'OPENAI_COMPATIBLE:emb-1',
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
      model: 'OPENAI_COMPATIBLE:emb-1',
      lowerBound: new Date(0),
      limit: 1,
      scanLimit: 1,
      alsoScore: [],
      maxDbMs: 2000,
    });
    expect([...scores.keys()]).toEqual([paraphrase.id]);
    expect(scores.get(paraphrase.id)).toBeGreaterThan(0.99);
  });

  it('is fully off unless enabled, configured with an embedding model, and allowed to receive Internal data', async () => {
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
