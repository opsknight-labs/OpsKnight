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
      apiKey: { id: 'key_test', scopes: ['escalation-policies:write'] },
      actor: {
        id: 'usr_admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamIds: [],
        apiKey: { id: 'key_test', scopes: ['escalation-policies:write'] },
      },
    })),
  };
});
vi.mock('@/lib/unique-names', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/unique-names')>()),
  assertEscalationPolicyNameAvailable: vi.fn(async (name: string) => name),
}));
vi.mock('@/lib/escalation/policy-validation', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/escalation/policy-validation')>()),
  escalationTargetExists: vi.fn().mockResolvedValue(true),
}));
const snapshot = vi.hoisted(() => ({
  lockResponderPolicy: vi.fn(),
  assertResponderPolicySnapshotSafeForApi: vi.fn(),
}));
vi.mock('@/lib/escalation/automation-snapshot', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/escalation/automation-snapshot')>()),
  ...snapshot,
}));

import { POST } from '@/app/api/v2/escalation-policies/route';
import { PATCH } from '@/app/api/v2/escalation-policies/[id]/route';

const db = prisma as any;
const step = { delayMinutes: 5, targetType: 'USER', targetId: 'user-1' };

function request(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/v2/escalation-policies/pol-1', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'if-match': '"1"' },
  });
}
const call = (body: unknown) =>
  PATCH(request('PATCH', body), { params: Promise.resolve({ id: 'pol-1' }) } as any);

describe('escalation policy writes through API v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.escalationPolicy.findUnique.mockResolvedValue({ id: 'pol-1', name: 'Core', revision: 1 });
    db.escalationPolicy.update.mockResolvedValue({ id: 'pol-1', revision: 2 });
    db.escalationPolicy.create.mockResolvedValue({ id: 'pol-new', name: 'New' });
    db.escalationRule.findMany.mockResolvedValue([]);
    db.escalationRuleCondition = { deleteMany: vi.fn() };
  });

  it('refuses a PATCH that would leave the policy with no steps', async () => {
    const res = await call({ steps: [] });
    expect(res.status).toBe(400);
    expect(db.escalationRule.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a POST or PATCH with more steps than the UI and the responder snapshot allow', async () => {
    const steps = Array.from({ length: 51 }, () => step);
    expect((await call({ steps })).status).toBe(400);
    const created = await POST(request('POST', { name: 'Big', steps }));
    expect(created.status).toBe(400);
    expect(db.escalationPolicy.create).not.toHaveBeenCalled();
  });

  it('locks the policy and checks the resulting snapshot inside the PATCH transaction', async () => {
    const res = await call({ steps: [step] });
    expect(res.status).toBe(200);
    expect(snapshot.lockResponderPolicy).toHaveBeenCalledWith(expect.anything(), 'pol-1');
    expect(snapshot.assertResponderPolicySnapshotSafeForApi).toHaveBeenCalledWith(
      expect.anything(),
      'pol-1'
    );
  });

  it('checks the snapshot of a newly created policy', async () => {
    const res = await POST(request('POST', { name: 'New', steps: [step] }));
    expect(res.status).toBe(201);
    expect(snapshot.assertResponderPolicySnapshotSafeForApi).toHaveBeenCalledWith(
      expect.anything(),
      'pol-new'
    );
  });
});
