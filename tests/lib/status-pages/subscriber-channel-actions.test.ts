import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  findUnique: vi.fn(),
  executeRaw: vi.fn(),
  audit: vi.fn(),
  rebuild: vi.fn(),
}));
vi.mock('@/lib/prisma', () => {
  const tx = { $executeRaw: mocks.executeRaw };
  return {
    default: {
      statusPage: { findUnique: mocks.findUnique },
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    },
  };
});
vi.mock('@/lib/rbac', () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: mocks.audit }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/notification-providers', () => ({ isChannelAvailable: async () => true }));
vi.mock('@/lib/status-pages/snapshot', () => ({ rebuildStatusPageSnapshot: mocks.rebuild }));

import { saveSubscriberChannelsAction } from '@/app/(app)/settings/status-pages/subscriber-channel-actions';

describe('saveSubscriberChannelsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdmin.mockResolvedValue({ id: 'admin1' });
    mocks.findUnique.mockResolvedValue({ subscriberChannels: ['EMAIL', 'WEBHOOK'] });
  });

  it('needs an admin', async () => {
    mocks.assertAdmin.mockRejectedValue(new Error('no'));
    expect(await saveSubscriberChannelsAction({ statusPageId: 'p1', channels: ['EMAIL'] })).toEqual(
      { ok: false, error: 'Admin access required.' }
    );
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('rejects unknown channels', async () => {
    const result = await saveSubscriberChannelsAction({ statusPageId: 'p1', channels: ['FAX'] });
    expect(result.ok).toBe(false);
  });

  it('saves in canonical order, audits old and new, and republishes', async () => {
    const result = await saveSubscriberChannelsAction({
      statusPageId: 'p1',
      channels: ['SMS', 'EMAIL', 'SMS'],
    });
    expect(result).toEqual({ ok: true, channels: ['EMAIL', 'SMS'] });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'status_page.subscriber_channels_updated',
        actor: { type: 'USER', id: 'admin1' },
        oldValue: { channels: ['EMAIL', 'WEBHOOK'] },
        newValue: { channels: ['EMAIL', 'SMS'] },
      }),
      expect.anything()
    );
    expect(mocks.rebuild).toHaveBeenCalledWith('p1');
  });
});
