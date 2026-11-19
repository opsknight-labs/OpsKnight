import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  systemSettings: { findUnique: vi.fn(), upsert: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({
  default: { $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)) },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(async () => ({ id: 'admin-1' })),
}));
vi.mock('@/lib/encrypted-provider-config', () => ({
  decryptProviderConfig: vi.fn(),
  maskSensitiveFields: vi.fn(),
}));

import { saveOutboundWebhookSettings } from '@/app/(app)/settings/system/actions';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

describe('saveOutboundWebhookSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the switch and audits old and new values', async () => {
    tx.systemSettings.findUnique.mockResolvedValue({ allowInsecureWebhookUrls: false });
    await expect(saveOutboundWebhookSettings(true)).resolves.toEqual({
      allowInsecureWebhookUrls: true,
    });
    expect(tx.systemSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      update: { allowInsecureWebhookUrls: true },
      create: { id: 'default', allowInsecureWebhookUrls: true },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.webhook_http.updated',
        oldValue: { allowInsecureWebhookUrls: false },
        newValue: { allowInsecureWebhookUrls: true },
      }),
      tx
    );
  });

  it('refuses non-admins', async () => {
    vi.mocked(assertAdmin).mockRejectedValueOnce(new Error('Forbidden'));
    await expect(saveOutboundWebhookSettings(true)).rejects.toThrow('Forbidden');
    expect(tx.systemSettings.upsert).not.toHaveBeenCalled();
  });
});
