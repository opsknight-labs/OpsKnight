import { beforeEach, describe, expect, it } from 'vitest';
import { reserveAiTokens, recordAiUsage } from '@/lib/intelligence/ai/budget';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

describe('atomic AI token reservations', () => {
  it('serializes concurrent admission against global and personal ceilings', async () => {
    const user = await createTestUser();
    const limits = { dailyTokenBudget: 1000, userDailyTokenBudget: 600 };
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => reserveAiTokens(user.id, limits, 200))
    );
    expect(attempts.filter(Boolean)).toHaveLength(3);
    const other = await createTestUser();
    expect(await reserveAiTokens(other.id, limits, 400)).not.toBeNull();
    expect(await reserveAiTokens('system:embed', limits, 1)).toBeNull();
  });
  it('settles once, releases the estimate and charges the reserved UTC day', async () => {
    const user = await createTestUser();
    const beforeMidnight = new Date('2026-10-29T23:59:59Z');
    const reservation = await reserveAiTokens(
      user.id,
      { dailyTokenBudget: 1000 },
      900,
      120000,
      beforeMidnight
    );
    expect(reservation).not.toBeNull();
    const usage = { inputTokens: 30, outputTokens: 20 };
    await Promise.all(
      Array.from({ length: 4 }, () =>
        recordAiUsage(usage, new Date('2026-10-30T00:00:01Z'), user.id, reservation!)
      )
    );
    expect(await db.aiUsageDay.findUnique({ where: { day: '2026-10-29' } })).toMatchObject({
      requests: 1,
      inputTokens: 30,
      outputTokens: 20,
    });
    expect(await db.aiUsageUserDay.findFirst()).toMatchObject({ tokens: 50 });
    expect(
      await reserveAiTokens(user.id, { dailyTokenBudget: 1000 }, 950, 120000, beforeMidnight)
    ).not.toBeNull();
  });
  it('expires abandoned reservations and records global usage when a user was deleted', async () => {
    const user = await createTestUser();
    const now = new Date('2026-10-29T12:00:00Z');
    const reservation = await reserveAiTokens(
      user.id,
      { dailyTokenBudget: 1000 },
      1000,
      60000,
      now
    );
    expect(await reserveAiTokens(user.id, { dailyTokenBudget: 1000 }, 1, 60000, now)).toBeNull();
    expect(
      await reserveAiTokens(
        'system:embed',
        { dailyTokenBudget: 1000 },
        1000,
        60000,
        new Date(+now + 61000)
      )
    ).not.toBeNull();
    await db.user.delete({ where: { id: user.id } });
    await recordAiUsage({ inputTokens: 10, outputTokens: 0 }, now, user.id, reservation!);
    expect(await db.aiUsageDay.findFirst()).toMatchObject({ requests: 1, inputTokens: 10 });
  });
});
