import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    webhookIntegration: { create: vi.fn() },
    service: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({ assertCanModifyService: vi.fn().mockResolvedValue({ id: 'u1' }) }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { $transaction: (fn: (tx: unknown) => unknown) => fn(mocks.tx) },
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/network-security', () => ({ assertSafeOutboundUrl: vi.fn() }));
vi.mock('@/lib/webhook-url-policy', () => ({ allowsInsecureWebhookUrls: vi.fn(async () => false) }));
vi.mock('@/lib/unique-names', () => ({
  assertWebhookIntegrationNameAvailable: vi.fn(async (name: string) => name),
  UniqueNameConflictError: class extends Error {},
}));

import { createWebhookIntegration } from '@/app/(app)/services/[id]/webhooks/actions';

const form = () => {
  const formData = new FormData();
  formData.set('name', 'Ops hook');
  formData.set('type', 'GENERIC');
  formData.set('url', 'https://example.com/hook');
  return formData;
};

describe('createWebhookIntegration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enables the WEBHOOK channel so the new webhook actually fires', async () => {
    mocks.tx.service.findUnique.mockResolvedValue({ serviceNotificationChannels: ['SLACK'] });
    await createWebhookIntegration('svc-1', form());
    expect(mocks.tx.service.update).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { serviceNotificationChannels: { push: 'WEBHOOK' } },
    });
  });

  it('leaves channels alone when WEBHOOK is already on', async () => {
    mocks.tx.service.findUnique.mockResolvedValue({ serviceNotificationChannels: ['WEBHOOK'] });
    await createWebhookIntegration('svc-1', form());
    expect(mocks.tx.service.update).not.toHaveBeenCalled();
  });
});
