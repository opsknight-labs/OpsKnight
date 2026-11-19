import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  webhookIntegration: { create: vi.fn() },
  service: { findUnique: vi.fn(), update: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    webhookIntegration: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ assertCanModifyService: vi.fn(async () => ({ id: 'user-1' })) }));
vi.mock('@/lib/unique-names', () => ({
  assertWebhookIntegrationNameAvailable: vi.fn(async (name: string) => name),
  UniqueNameConflictError: class extends Error {},
}));
vi.mock('@/lib/network-security', () => ({
  assertSafeOutboundUrl: vi.fn(async (url: string, options?: { requireHttps?: boolean }) => {
    if (options?.requireHttps && !url.startsWith('https://')) throw new Error('HTTPS is required');
    return new URL(url);
  }),
}));
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn(async (v: string) => `enc:${v}`) }));
const allowHttp = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/webhook-url-policy', () => ({
  allowsInsecureWebhookUrls: vi.fn(async () => allowHttp.value),
}));

import { createWebhookIntegration } from '@/app/(app)/services/[id]/webhooks/actions';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('createWebhookIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowHttp.value = false;
  });

  it('rejects http:// webhook URLs by default', async () => {
    tx.service.findUnique.mockResolvedValue({ serviceNotificationChannels: ['WEBHOOK'] });
    await expect(
      createWebhookIntegration(
        'svc-1',
        form({ name: 'Internal', type: 'GENERIC', url: 'http://tools.example.com/hook' })
      )
    ).rejects.toThrow("REDIRECT:/services/svc-1/webhooks/new?error=invalid-url");
    expect(tx.webhookIntegration.create).not.toHaveBeenCalled();
  });

  it('accepts http:// webhook URLs when an admin allows them', async () => {
    allowHttp.value = true;
    tx.service.findUnique.mockResolvedValue({ serviceNotificationChannels: ['WEBHOOK'] });
    await expect(
      createWebhookIntegration(
        'svc-1',
        form({ name: 'Internal', type: 'GENERIC', url: 'http://tools.example.com/hook' })
      )
    ).rejects.toThrow('REDIRECT:/services/svc-1?tab=notifications&saved=1');
    expect(tx.webhookIntegration.create).toHaveBeenCalled();
  });

  it('enables the service WEBHOOK channel so the new webhook actually fires', async () => {
    tx.service.findUnique.mockResolvedValue({ serviceNotificationChannels: ['EMAIL'] });

    await expect(
      createWebhookIntegration(
        'svc-1',
        form({ name: 'Discord', type: 'DISCORD', url: 'https://discord.com/api/webhooks/1/x' })
      )
    ).rejects.toThrow('REDIRECT:/services/svc-1?tab=notifications&saved=1');

    expect(tx.webhookIntegration.create).toHaveBeenCalled();
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { serviceNotificationChannels: { push: 'WEBHOOK' } },
    });
  });

  it('does not duplicate an already-enabled WEBHOOK channel', async () => {
    tx.service.findUnique.mockResolvedValue({ serviceNotificationChannels: ['WEBHOOK'] });

    await expect(
      createWebhookIntegration(
        'svc-1',
        form({ name: 'Chat', type: 'GOOGLE_CHAT', url: 'https://chat.googleapis.com/x' })
      )
    ).rejects.toThrow('REDIRECT');
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it('redirects with a readable error for plain HTTP or unsafe URLs', async () => {
    await expect(
      createWebhookIntegration(
        'svc-1',
        form({ name: 'Plain', type: 'GENERIC', url: 'http://example.com/hook' })
      )
    ).rejects.toThrow('REDIRECT:/services/svc-1/webhooks/new?error=invalid-url');
    expect(tx.webhookIntegration.create).not.toHaveBeenCalled();
  });
});
