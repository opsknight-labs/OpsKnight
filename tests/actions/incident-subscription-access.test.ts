import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  assertCanViewIncident: vi.fn(),
  watcherUpsert: vi.fn(),
  watcherFindFirst: vi.fn(),
  watcherDeleteMany: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  getCurrentUser: mocks.getCurrentUser,
  assertCanViewIncident: mocks.assertCanViewIncident,
  assertResponderOrAbove: vi.fn(),
  assertCanCreateIncidentForService: vi.fn(),
  assertCanAddIncidentNote: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: mocks.transaction },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { addWatcher, removeWatcher } from '@/app/(app)/incidents/actions';

describe('incident self-subscription actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', role: 'USER' });
    mocks.assertCanViewIncident.mockResolvedValue({ id: 'user-1', role: 'USER' });
    mocks.watcherUpsert.mockResolvedValue({ id: 'watcher-1' });
    mocks.watcherDeleteMany.mockResolvedValue({ count: 1 });
    mocks.eventCreate.mockResolvedValue({ id: 'event-1' });
    mocks.transaction.mockImplementation(async callback =>
      callback({
        incidentWatcher: {
          upsert: mocks.watcherUpsert,
          findFirst: mocks.watcherFindFirst,
          deleteMany: mocks.watcherDeleteMany,
        },
        incidentEvent: { create: mocks.eventCreate },
      })
    );
  });

  it('allows a USER to subscribe themselves as a follower to a visible incident', async () => {
    await addWatcher('inc-1', 'user-1', 'FOLLOWER');

    expect(mocks.assertCanViewIncident).toHaveBeenCalledWith('inc-1');
    expect(mocks.watcherUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'user-1', role: 'FOLLOWER' }),
      })
    );
  });

  it('denies subscribing another user or choosing an elevated watcher role', async () => {
    await expect(addWatcher('inc-1', 'user-2', 'FOLLOWER')).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    await expect(addWatcher('inc-1', 'user-1', 'EXEC')).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(mocks.watcherUpsert).not.toHaveBeenCalled();
  });

  it('requires visibility before a USER can subscribe', async () => {
    mocks.assertCanViewIncident.mockRejectedValue(new Error('Forbidden'));

    await expect(addWatcher('inc-1', 'user-1', 'FOLLOWER')).rejects.toThrow('Forbidden');
    expect(mocks.watcherUpsert).not.toHaveBeenCalled();
  });

  it('allows a USER to remove only their own watcher record', async () => {
    mocks.watcherFindFirst.mockResolvedValue({ userId: 'user-1' });

    await removeWatcher('inc-1', 'watcher-1');

    expect(mocks.watcherDeleteMany).toHaveBeenCalledWith({
      where: { id: 'watcher-1', incidentId: 'inc-1', userId: 'user-1' },
    });
  });

  it('denies a USER removing another subscriber', async () => {
    mocks.watcherFindFirst.mockResolvedValue({ userId: 'user-2' });

    await expect(removeWatcher('inc-1', 'watcher-2')).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(mocks.watcherDeleteMany).not.toHaveBeenCalled();
  });

  it('keeps responder management of other subscribers', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'responder-1', role: 'RESPONDER' });
    mocks.watcherFindFirst.mockResolvedValue({ userId: 'user-2' });

    await addWatcher('inc-1', 'user-2', 'STAKEHOLDER');
    await removeWatcher('inc-1', 'watcher-2');

    expect(mocks.assertCanViewIncident).not.toHaveBeenCalled();
    expect(mocks.watcherDeleteMany).toHaveBeenCalledWith({
      where: { id: 'watcher-2', incidentId: 'inc-1' },
    });
  });
});
