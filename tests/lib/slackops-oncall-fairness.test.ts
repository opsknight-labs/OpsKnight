import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { slackOnCallSync: { findMany: h.findMany } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/escalation/target-resolution', () => ({ resolveEscalationTarget: vi.fn() }));
vi.mock('@/lib/slack', () => ({ getSlackInstall: vi.fn() }));
vi.mock('@/lib/slack/api', () => ({ callSlackApi: vi.fn() }));
vi.mock('@/lib/slack/live-card', () => ({ lookupSlackUserIdByEmail: vi.fn() }));

import { runOnCallSyncPass } from '@/lib/slack/oncall-sync';

describe('on-call sync batch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('takes the least recently attempted mappings first, so a skipped one cannot starve the rest', async () => {
    h.findMany.mockResolvedValue([]);
    await runOnCallSyncPass(new Date('2026-11-28T10:00:00Z'));
    const args = h.findMany.mock.calls[0][0];
    // A mapping that is skipped never gets lastSyncedAt, so ordering by it would pin it to the front.
    expect(args.orderBy).toEqual({ updatedAt: 'asc' });
    expect(args.take).toBe(50);
  });
});
