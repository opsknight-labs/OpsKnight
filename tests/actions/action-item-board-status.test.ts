/* eslint-disable @typescript-eslint/no-explicit-any -- partial prisma mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionItemStatus } from '@prisma/client';
import prisma from '@/lib/prisma';

const rbac = vi.hoisted(() => ({
  assertResponderOrAbove: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
}));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateActionItemStatus } from '@/app/(app)/action-items/actions';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const db = prisma as any;
const scoped: AuthorizationActor = {
  id: 'scoped-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-a'],
};

beforeEach(() => {
  vi.clearAllMocks();
  rbac.assertResponderOrAbove.mockResolvedValue({ id: 'scoped-1' });
  rbac.getCurrentAuthorizationActor.mockResolvedValue(scoped);
  db.actionItem.findUnique.mockResolvedValue(null);
  db.postmortem.findFirst.mockResolvedValue({ id: 'pm-other', actionItems: [{ id: 'x' }] });
});

describe('updateActionItemStatus', () => {
  it("looks the item up only among postmortems the actor can read, so other teams' items are not found", async () => {
    await updateActionItemStatus('item-1', ActionItemStatus.COMPLETED);

    expect(db.actionItem.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1', postmortem: postmortemReadWhere(scoped) },
      })
    );
    expect(db.actionItem.update).not.toHaveBeenCalled();
  });
});
