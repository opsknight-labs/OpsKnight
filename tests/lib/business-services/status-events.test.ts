import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  notify: vi.fn(),
  webhook: vi.fn(),
  health: new Map<string, { status: string; since: Date | null }>(),
  targets: vi.fn(),
  chat: vi.fn(),
  drafts: vi.fn(),
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example' }));
vi.mock('@/lib/business-services/chat-channels', () => ({
  businessServiceChatTargets: mocks.targets,
  enqueueBusinessServiceChat: mocks.chat,
}));
vi.mock('@/lib/business-services/status-page-drafts', () => ({
  draftStatusPageUpdates: mocks.drafts,
}));
vi.mock('@/lib/prisma', () => ({
  default: { businessService: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/in-app-notifications', () => ({ createInAppNotifications: mocks.notify }));
vi.mock('@/lib/status-page-webhooks', () => ({ triggerStatusPageWebhooks: mocks.webhook }));
vi.mock('@/lib/business-services/health', () => ({
  getHealthSnapshot: async () => ({ health: mocks.health }),
}));

import {
  describeStatusChange,
  emitBusinessServiceStatusChanges,
} from '@/lib/business-services/status-events';

const row = (lastNotifiedStatus: string | null, lastNotifiedStatusAt: Date | null = null) => ({
  lastNotifiedStatusAt,
  id: 'bs1',
  name: 'Checkout',
  lastNotifiedStatus,
  contactChannel: '#checkout',
  ownerTeamId: 't1',
  autoPublishStatusUpdates: false,
  followers: [{ userId: 'u1' }],
  statusPages: [{ statusPageId: 'p1', displayName: null }],
});

describe('emitBusinessServiceStatusChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.health.set('bs1', { status: 'MAJOR_OUTAGE', since: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.targets.mockResolvedValue([{ provider: 'SLACK', channel: '#checkout' }]);
    mocks.chat.mockResolvedValue(1);
    mocks.drafts.mockResolvedValue(1);
  });

  it('posts to chat and drafts status-page updates under the transition key', async () => {
    mocks.findMany.mockResolvedValue([row('OPERATIONAL')]);
    expect(await emitBusinessServiceStatusChanges()).toBe(1);
    const chat = mocks.chat.mock.calls[0][0];
    expect(chat).toMatchObject({
      businessServiceId: 'bs1',
      targets: [{ provider: 'SLACK', channel: '#checkout' }],
      title: 'Checkout is now major outage',
      url: 'https://ops.example/services/business/bs1',
    });
    expect(mocks.drafts).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'OPERATIONAL',
        to: 'MAJOR_OUTAGE',
        changeKey: chat.eventKey,
        pages: [{ statusPageId: 'p1', displayName: null }],
      })
    );
  });

  it('does not record the change when drafting fails, so the next run retries it', async () => {
    mocks.findMany.mockResolvedValue([row('OPERATIONAL')]);
    mocks.drafts.mockRejectedValueOnce(new Error('db down'));
    expect(await emitBusinessServiceStatusChanges()).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('skips chat when the business service has no chat target', async () => {
    mocks.findMany.mockResolvedValue([row('OPERATIONAL')]);
    mocks.targets.mockResolvedValue([]);
    expect(await emitBusinessServiceStatusChanges()).toBe(1);
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('records a baseline without announcing the first status', async () => {
    mocks.findMany.mockResolvedValue([row(null)]);
    expect(await emitBusinessServiceStatusChanges()).toBe(0);
    expect(mocks.updateMany).toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.webhook).not.toHaveBeenCalled();
  });

  it('announces a change to followers and status-page webhooks once', async () => {
    mocks.findMany.mockResolvedValue([row('OPERATIONAL')]);
    expect(await emitBusinessServiceStatusChanges()).toBe(1);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['u1'], title: 'Checkout is now major outage' })
    );
    expect(mocks.webhook).toHaveBeenCalledWith(
      'p1',
      'business_service.status_changed',
      expect.objectContaining({ previousStatus: 'OPERATIONAL', status: 'MAJOR_OUTAGE' }),
      expect.any(String)
    );
  });

  it('stays silent when another instance already claimed the change or status is unchanged', async () => {
    mocks.findMany.mockResolvedValue([row('OPERATIONAL')]);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await emitBusinessServiceStatusChanges()).toBe(0);
    mocks.findMany.mockResolvedValue([row('MAJOR_OUTAGE')]);
    expect(await emitBusinessServiceStatusChanges()).toBe(0);
    // The lost race still announced once (deduplicated downstream); the unchanged status did not.
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('keeps the same dedupe key when a failed announcement is retried, and records nothing', async () => {
    const at = new Date('2026-11-20T10:00:00Z');
    mocks.findMany.mockResolvedValue([row('OPERATIONAL', at)]);
    mocks.webhook.mockRejectedValueOnce(new Error('boom'));
    expect(await emitBusinessServiceStatusChanges(new Date('2026-11-26T10:00:00Z'))).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(await emitBusinessServiceStatusChanges(new Date('2026-11-26T10:01:00Z'))).toBe(1);
    const keys = mocks.notify.mock.calls.map(call => call[0].dedupeKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('debounces a change that follows another within the window', async () => {
    const now = new Date('2026-11-26T10:00:00Z');
    mocks.findMany.mockResolvedValue([row('OPERATIONAL', new Date(now.getTime() - 60_000))]);
    expect(await emitBusinessServiceStatusChanges(now)).toBe(0);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('describes a change in plain words', () => {
    expect(describeStatusChange('Search', 'DEGRADED', 'OPERATIONAL').message).toBe(
      'Its status changed from Degraded to Operational.'
    );
  });
});
