/* eslint-disable @typescript-eslint/no-explicit-any -- mock actor and arbitrary route plumbing */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const auth = vi.hoisted(() => ({ role: 'RESPONDER' as 'RESPONDER' | 'ADMIN' }));

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
    authenticateV2Request: vi.fn().mockImplementation(async () => {
      const apiKey = { id: 'key_test', scopes: ['services:write'] };
      const actor: AuthorizationActor = {
        id: 'usr_1',
        role: auth.role,
        status: 'ACTIVE',
        teamIds: ['team-a', 'team-b'],
        apiKey,
      };
      return { apiKey, actor };
    }),
  };
});

import { PATCH } from '@/app/api/v2/services/[id]/route';

const db = prisma as any;

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/v2/services/svc-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'svc-1' }) } as any
  );

describe('PATCH /api/v2/services/{id} team moves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = 'RESPONDER';
    db.service.findUnique.mockResolvedValue({ id: 'svc-1', teamId: 'team-a' });
    db.team.findUnique.mockResolvedValue({ id: 'team-b' });
    db.service.update.mockResolvedValue({
      id: 'svc-1',
      name: 'API',
      description: null,
      status: 'OPERATIONAL',
      teamId: 'team-b',
      escalationPolicyId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      revision: 2,
      team: null,
      policy: null,
    });
  });

  it('refuses a responder in both teams who moves a service to the other team', async () => {
    const res = await patch({ teamId: 'team-b' });
    expect(res.status).toBe(403);
    expect(db.service.update).not.toHaveBeenCalled();
  });

  it('lets a responder resend the current team and edit other fields', async () => {
    db.service.update.mockResolvedValueOnce({
      id: 'svc-1',
      name: 'API',
      description: 'x',
      status: 'OPERATIONAL',
      teamId: 'team-a',
      escalationPolicyId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      revision: 2,
      team: null,
      policy: null,
    });
    db.team.findUnique.mockResolvedValue({ id: 'team-a' });
    expect((await patch({ teamId: 'team-a', description: 'x' })).status).toBe(200);
  });

  it('lets an administrator move a service between teams', async () => {
    auth.role = 'ADMIN';
    expect((await patch({ teamId: 'team-b' })).status).toBe(200);
    expect(db.service.update).toHaveBeenCalledTimes(1);
  });
});
