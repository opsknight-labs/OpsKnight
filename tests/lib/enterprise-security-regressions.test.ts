import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: vi.fn() },
    statusPageService: { findMany: vi.fn() },
    statusPageWebhook: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/encryption', () => ({
  getEncryptionKey: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { encrypt, getEncryptionKey } from '@/lib/encryption';
import { encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { triggerWebhooksForService } from '@/lib/status-page-webhooks';

describe('enterprise security regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to persist provider secrets when encryption is unavailable', async () => {
    vi.mocked(getEncryptionKey).mockReturnValue(null);

    await expect(
      encryptProviderConfig('resend', { apiKey: 'plaintext-secret', from: 'ops@example.com' })
    ).rejects.toThrow('Provider secrets cannot be stored');
  });

  it('fails the whole provider write when a sensitive field cannot be encrypted', async () => {
    vi.mocked(getEncryptionKey).mockReturnValue('a'.repeat(64));
    vi.mocked(encrypt).mockRejectedValue(new Error('encryption failed'));

    await expect(
      encryptProviderConfig('resend', { apiKey: 'plaintext-secret' })
    ).rejects.toThrow('Failed to encrypt provider config field: apiKey');
  });

  it('does not publish a private incident even when caller data says it is public', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({ visibility: 'PRIVATE' } as never);

    await triggerWebhooksForService('service-1', 'incident.created', {
      id: 'incident-1',
      visibility: 'PUBLIC',
    });

    expect(prisma.statusPageService.findMany).not.toHaveBeenCalled();
    expect(prisma.statusPageWebhook.findMany).not.toHaveBeenCalled();
  });

  it('requires an explicit status-page mapping before delivering', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({ visibility: 'PUBLIC' } as never);
    vi.mocked(prisma.statusPageService.findMany).mockResolvedValue([]);

    await triggerWebhooksForService('service-1', 'incident.created', { id: 'incident-1' });

    expect(prisma.statusPageWebhook.findMany).not.toHaveBeenCalled();
  });
});
