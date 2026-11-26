import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    service: { count: vi.fn() },
    automationVersionPolicyRef: { count: vi.fn() },
    incidentAutomationDecision: { count: vi.fn() },
    escalationRule: { deleteMany: vi.fn() },
    escalationPolicy: { delete: vi.fn() },
  };
  return { tx, logAudit: vi.fn() };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    // The pre-checks outside the transaction see nothing in use: the race starts after them.
    automationVersionPolicyRef: { findMany: async () => [] },
    incidentAutomationDecision: { count: async () => 0 },
    service: { findMany: async () => [] },
    $transaction: async (callback: (tx: typeof m.tx) => unknown) => callback(m.tx),
  },
}));
vi.mock('@/lib/rbac', () => ({ assertAdmin: async () => ({ id: 'admin-1' }) }));
vi.mock('@/lib/audit', () => ({ logAudit: m.logAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { deletePolicy } from '@/app/(app)/policies/actions';

describe('deletePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.service.count.mockResolvedValue(0);
    m.tx.automationVersionPolicyRef.count.mockResolvedValue(0);
    m.tx.incidentAutomationDecision.count.mockResolvedValue(0);
  });

  it('locks the policy, then deletes it and audits in the same transaction', async () => {
    const result = await deletePolicy('pol-1');

    expect(result).toEqual({ success: true });
    expect(m.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(m.tx.escalationPolicy.delete).toHaveBeenCalledWith({ where: { id: 'pol-1' } });
    expect(m.logAudit.mock.calls[0]![1]).toBe(m.tx);
  });

  it('refuses when a service was assigned the policy after the first check', async () => {
    m.tx.service.count.mockResolvedValue(1);

    const result = await deletePolicy('pol-1');

    expect(result).toMatchObject({ error: expect.stringContaining('started using it') });
    expect(m.tx.escalationPolicy.delete).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });
});
