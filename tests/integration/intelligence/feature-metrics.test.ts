import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { collectIntelligenceMetrics } from '@/lib/intelligence/metrics';
import { invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider } from '@/lib/intelligence/ai/settings';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const now = new Date('2026-11-05T12:00:00Z');
const names = (samples: Awaited<ReturnType<typeof collectIntelligenceMetrics>>) =>
  Object.fromEntries(samples.map(sample => [sample.name, sample.value]));
let provider: FakeServer;
beforeAll(async () => {
  provider = await startFakeModel();
});
afterAll(async () => {
  await provider.close();
});
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
  invalidateGatewayCache();
  provider.requests.length = 0;
});

it('exports zero feature failures and disabled embedding on an unused installation', async () => {
  const samples = names(await collectIntelligenceMetrics(+now));
  expect(samples.opsknight_intelligence_embedding_enabled).toBe(0);
  expect(samples.opsknight_intelligence_embedding_pending).toBe(0);
  expect(samples.opsknight_intelligence_digest_failed_recipients_last_7d).toBe(0);
  expect(samples.opsknight_intelligence_squire_actions_uncertain_last_24h).toBe(0);
  expect(samples.opsknight_intelligence_feature_probe_failed).toBe(0);
});

it('reports bounded recent digest and confirmed-action outcomes without identifiers or private payloads', async () => {
  const user = await createTestUser();
  await db.intelligenceDigestRun.createMany({
    data: [
      {
        weekKey: '2026-W45',
        scheduledFor: now,
        status: 'COMPLETED',
        startedAt: new Date(+now - 3600000),
        failedTo: ['private-recipient-one', 'private-recipient-two'],
      },
      {
        weekKey: '2026-W44',
        scheduledFor: now,
        status: 'SENDING',
        startedAt: new Date(+now - 7200000),
      },
      {
        weekKey: '2026-W43',
        scheduledFor: now,
        status: 'COMPLETED',
        startedAt: new Date(+now - 8 * 86400000),
        failedTo: ['old-private-recipient'],
      },
    ],
  });
  const receipts = [
    ['success', 'SUCCEEDED', 1000],
    ['failure', 'FAILED', 1000],
    ['unknown', 'UNKNOWN', 1000],
    ['stale-running', 'RUNNING', 600000],
    ['fresh-running', 'RUNNING', 1000],
    ['stale-reserved', 'RESERVED', 600000],
    ['old', 'UNKNOWN', 2 * 86400000],
  ] as const;
  await db.squireActionReceipt.createMany({
    data: receipts.map(([id, status, age]) => ({
      id,
      userId: user.id,
      action: 'add_incident_note',
      status,
      createdAt: new Date(+now - age),
      startedAt: status === 'RUNNING' ? new Date(+now - age) : null,
      intentEncrypted: 'private-intent-canary',
      failureCode: 'private-error-canary',
    })),
  });
  const raw = await collectIntelligenceMetrics(+now);
  const samples = names(raw);
  expect(samples.opsknight_intelligence_digest_failed_recipients_last_7d).toBe(2);
  expect(samples.opsknight_intelligence_digest_oldest_sending_age_seconds).toBe(7200);
  expect(samples.opsknight_intelligence_squire_actions_confirmed_last_24h).toBe(6);
  expect(samples.opsknight_intelligence_squire_actions_succeeded_last_24h).toBe(1);
  expect(samples.opsknight_intelligence_squire_actions_failed_last_24h).toBe(1);
  expect(samples.opsknight_intelligence_squire_actions_uncertain_last_24h).toBe(3);
  expect(JSON.stringify(raw)).not.toMatch(/private-|old-private|add_incident_note/);
});

it('exposes truncation instead of claiming complete action coverage beyond the sample cap', async () => {
  const user = await createTestUser();
  await db.squireActionReceipt.createMany({
    data: Array.from({ length: 5001 }, (_, i) => ({
      id: `receipt-${i.toString().padStart(5, '0')}`,
      userId: user.id,
      action: 'add_incident_note',
      status: 'SUCCEEDED',
      createdAt: new Date(+now - 1000),
    })),
  });
  const samples = names(await collectIntelligenceMetrics(+now));
  expect(samples.opsknight_intelligence_squire_actions_confirmed_last_24h).toBe(5000);
  expect(samples.opsknight_intelligence_squire_actions_sample_truncated).toBe(1);
});

it('reports the embedding backlog and allowance including live holds without calling a provider', async () => {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: true,
      embeddingsEnabled: true,
      dailyTokenBudget: 1000,
      backgroundEmbeddingBudgetPercent: 20,
    },
  });
  await saveAiProvider(
    null,
    {
      name: 'Metrics fixture',
      kind: 'OPENAI_COMPATIBLE',
      model: 'm',
      embeddingModel: 'em',
      baseUrl: provider.url,
      apiKey: 'local-fixture-key',
      isExternal: false,
      allowPrivateNetwork: true,
      maxDataClass: 'PERSONAL',
      priority: 1,
      enabled: true,
    },
    { actorId: admin.id, source: 'UI' }
  );
  const service = await createTestService('Metrics service');
  const incident = await createTestIncident('Payment failing', service.id, {
    createdAt: new Date(+now - 1000),
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  await db.aiUsageDay.create({
    data: { day: '2026-11-05', inputTokens: 50, backgroundEmbeddingTokens: 50 },
  });
  await db.aiTokenReservation.createMany({
    data: [
      {
        day: '2026-11-05',
        actorId: 'intelligence:embedder',
        tokens: 100,
        expiresAt: new Date(+now + 60000),
      },
      {
        day: '2026-11-05',
        actorId: 'intelligence:embedder',
        tokens: 100,
        expiresAt: new Date(+now - 1),
      },
      { day: '2026-11-05', actorId: admin.id, tokens: 50, expiresAt: new Date(+now + 60000) },
    ],
  });
  invalidateGatewayCache();
  const samples = names(await collectIntelligenceMetrics(+now));
  expect(samples.opsknight_intelligence_embedding_enabled).toBe(1);
  expect(samples.opsknight_intelligence_embedding_pending).toBe(1);
  expect(samples.opsknight_intelligence_embedding_budget_remaining_tokens).toBe(50);
  expect(provider.requests).toHaveLength(0);
});

it('caps digest history reads and explicitly exposes omitted coverage', async () => {
  await db.intelligenceDigestRun.createMany({
    data: Array.from({ length: 9 }, (_, index) => ({
      weekKey: `2026-W${String(index + 1).padStart(2, '0')}`,
      scheduledFor: now,
      startedAt: new Date(+now - 1000),
      status: 'COMPLETED',
      failedTo: ['private-recipient'],
    })),
  });
  const samples = names(await collectIntelligenceMetrics(+now));
  expect(samples.opsknight_intelligence_digest_failed_recipients_last_7d).toBe(8);
  expect(samples.opsknight_intelligence_digest_sample_truncated).toBe(1);
});
