import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  tx: {
    integration: { findFirst: vi.fn(), delete: vi.fn() },
    inboundDelivery: { count: vi.fn(), deleteMany: vi.fn() },
  },
  logAudit: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ assertCanModifyService: mocks.assertCanModifyService }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { $transaction: (fn: (tx: unknown) => unknown) => fn(mocks.tx) },
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { deleteIntegration } from '@/app/(app)/services/actions';

describe('deleteIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1' });
    mocks.tx.integration.findFirst.mockResolvedValue({ id: 'int-1' });
  });

  it('refuses while deliveries are in flight and returns the reason', async () => {
    mocks.tx.inboundDelivery.count.mockResolvedValue(2);
    const result = await deleteIntegration('int-1', 'svc-1');
    expect(result.error).toMatch(/in progress/);
    expect(mocks.tx.integration.delete).not.toHaveBeenCalled();
  });

  it('purges delivery history with the integration', async () => {
    mocks.tx.inboundDelivery.count.mockResolvedValue(0);
    expect(await deleteIntegration('int-1', 'svc-1')).toEqual({});
    expect(mocks.tx.inboundDelivery.deleteMany).toHaveBeenCalledWith({
      where: { integrationId: 'int-1' },
    });
    expect(mocks.tx.integration.delete).toHaveBeenCalledWith({ where: { id: 'int-1' } });
  });

  it('returns permission errors instead of throwing', async () => {
    mocks.assertCanModifyService.mockRejectedValue(new Error('Unauthorized. Nope.'));
    expect(await deleteIntegration('int-1', 'svc-1')).toEqual({ error: 'Unauthorized. Nope.' });
  });
});

describe('createIntegration', () => {
  it('returns the ARN hint instead of throwing a sanitised error', async () => {
    const { createIntegration } = await import('@/app/(app)/services/actions');
    const formData = new FormData();
    formData.set('serviceId', 'svc-1');
    formData.set('name', 'CW');
    formData.set('type', 'CLOUDWATCH');
    formData.set('snsTopicArn', 'not-an-arn');
    expect((await createIntegration(formData)).error).toMatch(/SNS Topic ARN/);
  });
});
