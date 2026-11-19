import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { findTeamDeletionBlocker } from '@/lib/teams/administration';

function client(openIncidents: number, escalationSteps: number) {
  return {
    incident: { count: vi.fn().mockResolvedValue(openIncidents) },
    escalationRule: { count: vi.fn().mockResolvedValue(escalationSteps) },
  } as unknown as Prisma.TransactionClient;
}

describe('findTeamDeletionBlocker', () => {
  it('allows deleting an unreferenced team', async () => {
    await expect(findTeamDeletionBlocker('team-1', client(0, 0))).resolves.toBeNull();
  });

  it('blocks while unresolved incidents or escalation steps reference the team', async () => {
    const db = client(2, 1);
    const reason = await findTeamDeletionBlocker('team-1', db);
    expect(reason).toContain('2 unresolved incident(s)');
    expect(reason).toContain('1 escalation policy step(s)');
    expect(db.incident.count).toHaveBeenCalledWith({
      where: { teamId: 'team-1', status: { not: 'RESOLVED' } },
    });
  });
});
