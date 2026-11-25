import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  notify: vi.fn(),
  webhook: vi.fn(),
  health: new Map<string, { status: string; since: Date | null }>(),
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

const row = (lastNotifiedStatus: string | null) => ({
  id: 'bs1',
  name: 'Checkout',
  lastNotifiedStatus,
  followers: [{ userId: 'u1' }],
  statusPages: [{ statusPageId: 'p1' }],
});

describe('emitBusinessServiceStatusChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.health.set('bs1', { status: 'MAJOR_OUTAGE', since: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });
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
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('describes a change in plain words', () => {
    expect(describeStatusChange('Search', 'DEGRADED', 'OPERATIONAL').message).toBe(
      'Its status changed from Degraded to Operational.'
    );
  });
});
