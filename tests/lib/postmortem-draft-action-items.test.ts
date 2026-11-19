import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { createDraftActionItemRows } from '@/lib/postmortems/action-item-commands';
import { getStoredActionItemId } from '@/lib/action-items';

describe('createDraftActionItemRows', () => {
  it('stores note-derived items as ActionItem rows with stable ids', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = { actionItem: { createMany } } as unknown as Prisma.TransactionClient;
    await createDraftActionItemRows(db, { id: 'pm1', incidentId: 'inc1' }, [
      { title: 'add disk alert' },
      { title: '' },
    ]);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: getStoredActionItemId({ postmortemId: 'pm1', index: 0 }),
          postmortemId: 'pm1',
          incidentId: 'inc1',
          title: 'add disk alert',
          status: 'OPEN',
          source: 'POSTMORTEM',
        }),
        expect.objectContaining({ title: 'Untitled action item' }),
      ],
    });
  });

  it('writes nothing when the draft has no action items', async () => {
    const createMany = vi.fn();
    const db = { actionItem: { createMany } } as unknown as Prisma.TransactionClient;
    await createDraftActionItemRows(db, { id: 'pm1', incidentId: 'inc1' }, []);
    expect(createMany).not.toHaveBeenCalled();
  });
});
