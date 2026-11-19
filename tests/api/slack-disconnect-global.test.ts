import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => {
  const tx = { service: { updateMany: vi.fn() }, slackIntegration: { delete: vi.fn() } };
  return {
    tx,
    slackIntegration: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
});

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN' }),
  assertAdmin: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE } from '@/app/api/slack/disconnect/route';

describe('global Slack disconnect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only targets the service-less (global) workspace', async () => {
    db.slackIntegration.findFirst.mockResolvedValue({ id: 'global-row' });

    const res = await DELETE(
      new NextRequest('http://localhost/api/slack/disconnect', { method: 'DELETE' })
    );

    expect(res.status).toBe(200);
    expect(db.slackIntegration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { services: { none: {} } } })
    );
    expect(db.tx.slackIntegration.delete).toHaveBeenCalledWith({ where: { id: 'global-row' } });
  });
});
