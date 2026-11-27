import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  actionItem: { findMany: vi.fn(), count: vi.fn() },
  inAppNotification: { findMany: vi.fn(), createMany: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: db }));

import { notifyOverdueActionItems } from '@/lib/action-item-overdue-notifications';
import { inAppNotificationHref } from '@/lib/notification-links';

const now = new Date('2026-11-26T02:00:00.000Z');
const items = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `item-${String(from + index).padStart(5, '0')}`,
    title: `Item ${from + index}`,
    ownerId: `owner-${from + index}`,
  }));

describe('overdue action item notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.actionItem.findMany.mockResolvedValue([]);
    db.actionItem.count.mockResolvedValue(0);
    db.inAppNotification.findMany.mockResolvedValue([]);
    db.inAppNotification.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
    db.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
  });

  it('keeps going past the first page so newer overdue items are notified too', async () => {
    db.actionItem.findMany
      .mockResolvedValueOnce(items(0, 500))
      .mockResolvedValueOnce(items(500, 3));

    const created = await notifyOverdueActionItems(now);

    expect(created).toBe(503);
    expect(db.actionItem.findMany).toHaveBeenCalledTimes(2);
    expect(db.actionItem.findMany.mock.calls[1]?.[0]).toMatchObject({
      cursor: { id: 'item-00499' },
      skip: 1,
    });
  });

  it('treats a due date as overdue only after its UTC day has passed', async () => {
    await notifyOverdueActionItems(new Date('2026-11-20T23:30:00.000Z'));

    // An item due on Nov 20 (stored 2026-11-20T00:00Z) is not overdue until Nov 21 begins.
    expect(db.actionItem.findMany.mock.calls[0]?.[0].where.dueDate).toEqual({
      lt: new Date('2026-11-20T00:00:00.000Z'),
    });
  });

  it('notifies only the owner, once per day, and never fans out to administrators', async () => {
    db.actionItem.findMany.mockResolvedValueOnce(items(0, 2));
    db.inAppNotification.findMany.mockResolvedValueOnce([
      { userId: 'owner-1', entityId: 'item-00001' },
    ]);

    await notifyOverdueActionItems(now);

    const data = db.inAppNotification.createMany.mock.calls[0]?.[0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ userId: 'owner-0', entityId: 'item-00000' });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('tells each administrator once about items with no owner', async () => {
    db.actionItem.count.mockResolvedValue(7);

    await notifyOverdueActionItems(now);

    const data = db.inAppNotification.createMany.mock.calls[0]?.[0].data;
    expect(data.map((row: { userId: string }) => row.userId)).toEqual(['admin-1', 'admin-2']);
    expect(data[0]).toMatchObject({ entityType: 'ACTION_ITEM', entityId: 'unowned' });
    expect(data[0].message).toContain('7 overdue');
  });

  it('gives the notification a link', () => {
    expect(inAppNotificationHref({ entityType: 'ACTION_ITEM', entityId: 'item-1' })).toBe(
      '/action-items'
    );
  });
});
