import { beforeEach, describe, expect, it } from 'vitest';
import {
  admitAiRequest,
  getTodayUsage,
  recordAiUsage,
  reserveAiTokens,
} from '@/lib/intelligence/ai/budget';
import { AI_SETTINGS_DEFAULTS } from '@/lib/intelligence/ai/contract';
import { updateAiSettings } from '@/lib/intelligence/ai/settings';
import { EMBEDDING_ACTOR } from '@/lib/intelligence/semantic/embedder';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

const now = new Date('2026-11-05T12:00:00Z');
const limits = {
  dailyTokenBudget: 1000,
  userDailyTokenBudget: 1000,
  requestsPerMinutePerUser: 100,
  backgroundEmbeddingBudgetPercent: 20,
};

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

describe('background embedding spend allocation', () => {
  it('reserves the background share atomically while leaving the rest available to people', async () => {
    const person = await createTestUser();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => reserveAiTokens(EMBEDDING_ACTOR, limits, 100, 120000, now))
    );
    expect(attempts.filter(Boolean)).toHaveLength(2);
    expect(await reserveAiTokens(person.id, limits, 800, 120000, now)).not.toBeNull();
    expect(await reserveAiTokens(person.id, limits, 1, 120000, now)).toBeNull();
  });

  it('settles actual usage once using the held identity, even if the caller passes another identity', async () => {
    const person = await createTestUser();
    const hold = await reserveAiTokens(EMBEDDING_ACTOR, limits, 200, 120000, now);
    expect(hold).not.toBeNull();
    await recordAiUsage({ inputTokens: 180, outputTokens: 20 }, now, person.id, hold!);
    await recordAiUsage({ inputTokens: 180, outputTokens: 20 }, now, person.id, hold!);
    expect(await getTodayUsage(now)).toMatchObject({
      requests: 1,
      inputTokens: 180,
      outputTokens: 20,
      backgroundEmbeddingTokens: 200,
    });
    expect(await db.aiUsageUserDay.count()).toBe(0);
    expect(await reserveAiTokens(EMBEDDING_ACTOR, limits, 1, 120000, now)).toBeNull();
    expect(await reserveAiTokens(person.id, limits, 800, 120000, now)).not.toBeNull();
  });

  it('releases unused estimates without allowing settled usage plus live holds to exceed the share', async () => {
    const hold = await reserveAiTokens(EMBEDDING_ACTOR, limits, 200, 120000, now);
    await recordAiUsage({ inputTokens: 50, outputTokens: 0 }, now, EMBEDDING_ACTOR, hold!);
    expect(await reserveAiTokens(EMBEDDING_ACTOR, limits, 150, 120000, now)).not.toBeNull();
    expect(await reserveAiTokens(EMBEDDING_ACTOR, limits, 1, 120000, now)).toBeNull();
  });

  it('can pause background spend without blocking interactive admission or reservations', async () => {
    const person = await createTestUser();
    const paused = { ...limits, backgroundEmbeddingBudgetPercent: 0 };
    expect(await admitAiRequest(EMBEDDING_ACTOR, paused, now)).toEqual({
      allowed: false,
      reason: 'BUDGET_EXHAUSTED',
    });
    expect(await reserveAiTokens(EMBEDDING_ACTOR, paused, 1, 120000, now)).toBeNull();
    expect(await admitAiRequest(person.id, paused, now)).toEqual({ allowed: true });
    expect(await reserveAiTokens(person.id, paused, 1000, 120000, now)).not.toBeNull();
  });

  it('ignores expired holds and resets both limits on the UTC day boundary', async () => {
    const expired = await reserveAiTokens(EMBEDDING_ACTOR, limits, 200, 60000, now);
    const later = new Date(+now + 61000);
    const live = await reserveAiTokens(EMBEDDING_ACTOR, limits, 200, 120000, later);
    expect(expired).not.toBeNull();
    expect(live).not.toBeNull();
    await recordAiUsage({ inputTokens: 200, outputTokens: 0 }, later, EMBEDDING_ACTOR, live!);
    expect(await admitAiRequest(EMBEDDING_ACTOR, limits, later)).toEqual({
      allowed: false,
      reason: 'BUDGET_EXHAUSTED',
    });
    const tomorrow = new Date('2026-11-06T00:00:00Z');
    expect(await admitAiRequest(EMBEDDING_ACTOR, limits, tomorrow)).toEqual({ allowed: true });
    expect(await reserveAiTokens(EMBEDDING_ACTOR, limits, 200, 120000, tomorrow)).not.toBeNull();
  });
});

it('preserves a saved allocation when an older settings client omits the new field', async () => {
  const admin = await createTestUser({ role: 'ADMIN' });
  const actor = { actorId: admin.id, source: 'UI' as const };
  await updateAiSettings(
    { ...AI_SETTINGS_DEFAULTS, backgroundEmbeddingBudgetPercent: 40, expectedRevision: 0 },
    actor
  );
  const { backgroundEmbeddingBudgetPercent: _allocation, ...older } = AI_SETTINGS_DEFAULTS;
  expect(_allocation).toBe(20);
  const saved = await updateAiSettings(
    { ...older, squireName: 'Updated name', expectedRevision: 1 },
    actor
  );
  expect(saved).toMatchObject({
    squireName: 'Updated name',
    backgroundEmbeddingBudgetPercent: 40,
    revision: 2,
  });
});
