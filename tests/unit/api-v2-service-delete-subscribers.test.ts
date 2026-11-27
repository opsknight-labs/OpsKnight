/* eslint-disable @typescript-eslint/no-explicit-any -- mock actor and arbitrary route plumbing */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  }),
}));
vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn().mockImplementation(async () => ({
      apiKey: { id: 'key_test', scopes: ['services:write'] },
      actor: {
        id: 'usr_admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamIds: [],
        apiKey: { id: 'key_test', scopes: ['services:write'] },
      },
    })),
  };
});
const revoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/status-pages/subscriber-administration', () => ({
  revokeSubscriptionsLosingLastSelection: revoke,
}));

import { DELETE } from '@/app/api/v2/services/[id]/route';

const db = prisma as any;

describe('DELETE /api/v2/services/{id}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revoke.mockResolvedValue(2);
    db.service.findUnique.mockResolvedValue({ id: 'svc-1', name: 'API', teamId: null });
    db.incident.count.mockResolvedValue(0);
    db.serviceObjective = { count: vi.fn().mockResolvedValue(0) };
  });

  it('revokes subscribers who only followed the service before the cascade can widen them', async () => {
    const order: string[] = [];
    revoke.mockImplementation(async () => {
      order.push('revoke');
      return 2;
    });
    db.service.delete.mockImplementation(async () => {
      order.push('delete');
      return {};
    });
    const res = await DELETE(
      new NextRequest('http://localhost/api/v2/services/svc-1', { method: 'DELETE' }),
      {
        params: Promise.resolve({ id: 'svc-1' }),
      } as any
    );
    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(expect.anything(), { serviceId: 'svc-1' });
    expect(order).toEqual(['revoke', 'delete']);
  });
});
