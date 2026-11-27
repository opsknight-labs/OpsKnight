import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const enqueueWarRoomSideEffects = vi.hoisted(() => vi.fn());
vi.mock('@/lib/event-outbox', () => ({ enqueueWarRoomSideEffects }));
vi.mock('server-only', () => ({}));

import { applyIncidentPriorityChange } from '@/lib/incidents/priority-command';

function client() {
  const update = vi.fn();
  return { update, tx: { incident: { update } } as unknown as Prisma.TransactionClient };
}

describe('applyIncidentPriorityChange', () => {
  it('records the STATUS_CHANGE event and posts the war-room message', async () => {
    const { tx, update } = client();

    await applyIncidentPriorityChange(tx, { incidentId: 'inc-1', priority: 'P1' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        priority: 'P1',
        events: { create: { type: 'STATUS_CHANGE', message: 'Priority updated to P1' } },
      },
    });
    expect(enqueueWarRoomSideEffects).toHaveBeenCalledWith(tx, 'inc-1', [
      { effect: 'WAR_ROOM_MESSAGE', message: '🎯 *Priority updated to P1*' },
    ]);
  });

  it('clears the priority and lets a caller word the timeline event', async () => {
    const { tx, update } = client();

    await applyIncidentPriorityChange(tx, { incidentId: 'inc-1', priority: null });
    expect(update.mock.calls[0][0].data.events.create.message).toBe(
      'Priority cleared (Unassigned)'
    );

    await applyIncidentPriorityChange(tx, {
      incidentId: 'inc-1',
      priority: null,
      eventMessage: 'Bulk priority updated to Auto by Alex',
    });
    expect(update.mock.calls[1][0].data.events.create.message).toBe(
      'Bulk priority updated to Auto by Alex'
    );
  });
});
