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

let currentActor: any = null;
vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn().mockImplementation(async () => ({
      apiKey: { id: 'key_test', scopes: ['schedules:write'] },
      actor: currentActor,
    })),
  };
});

import { DELETE } from '@/app/api/v2/schedules/[id]/route';

const db = prisma as any;

function actorWithRole(role: 'ADMIN' | 'RESPONDER') {
  return {
    id: `usr_${role.toLowerCase()}`,
    role,
    status: 'ACTIVE',
    teamIds: ['team_a'],
    apiKey: { id: 'key_test', scopes: ['schedules:write'] },
  };
}

function call() {
  const req = new NextRequest('http://localhost/api/v2/schedules/sch_1', { method: 'DELETE' });
  return DELETE(req, { params: Promise.resolve({ id: 'sch_1' }) } as any);
}

describe('DELETE /api/v2/schedules/{id}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.onCallSchedule.findUnique.mockResolvedValue({ id: 'sch_1', name: 'Primary' });
    db.escalationRule.findMany.mockResolvedValue([]);
  });

  it('refuses a responder key, matching the admin-only schedule delete in the UI', async () => {
    currentActor = actorWithRole('RESPONDER');
    const res = await call();
    expect(res.status).toBe(403);
    expect(db.onCallSchedule.delete).not.toHaveBeenCalled();
  });

  it('checks escalation steps inside the delete transaction and refuses a schedule in use', async () => {
    currentActor = actorWithRole('ADMIN');
    db.escalationRule.findMany.mockResolvedValue([{ id: 'r1', policy: { id: 'p1', name: 'Core' } }]);
    const res = await call();
    expect(res.status).toBe(409);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: expect.any(Number),
      maxWait: expect.any(Number),
    });
    expect(db.onCallSchedule.delete).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced schedule for an admin', async () => {
    currentActor = actorWithRole('ADMIN');
    const res = await call();
    expect(res.status).toBe(200);
    expect(db.onCallSchedule.delete).toHaveBeenCalledWith({ where: { id: 'sch_1' } });
  });
});
