import { describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { processPendingEscalations } from '@/lib/escalation';

// Local mock for this test file to ensure isolation
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('processPendingEscalations', () => {
  it('returns zero counts when nothing is pending', async () => {
    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(
      [] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>
    );

    const result = await processPendingEscalations(async () => ({ escalated: true }));

    expect(result).toEqual({
      processed: 0,
      total: 0,
      errors: undefined,
    });
  });

  it('processes pending incidents with provided executor', async () => {
    const pendingIncidents = [
      {
        id: 'inc-1',
        currentEscalationStep: null,
        escalationStatus: 'ESCALATING',
      },
      {
        id: 'inc-2',
        currentEscalationStep: 2,
        escalationStatus: 'ESCALATING',
      },
    ] satisfies Array<{
      id: string;
      currentEscalationStep: number | null;
      escalationStatus: string | null;
    }>;

    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce(
      pendingIncidents as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>
    );

    const executor = vi
      .fn()
      .mockResolvedValueOnce({ escalated: true })
      .mockResolvedValueOnce({ escalated: false, reason: 'completed' });

    const result = await processPendingEscalations(executor);

    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenNthCalledWith(1, 'inc-1', 0);
    expect(executor).toHaveBeenNthCalledWith(2, 'inc-2', 2);
    expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    // Terminal states are persisted by executeEscalation itself. The pending
    // processor must not reinterpret a terminal reason and overwrite that state.
    expect(prisma.incident.update).not.toHaveBeenCalled();
    expect(result.processed).toBe(1);
    expect(result.total).toBe(2);
  });
});
