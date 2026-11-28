import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('server-only', () => ({}));

const tx = vi.hoisted(() => ({
  runbookAgent: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  runbookAgentPoolMember: { deleteMany: vi.fn() },
}));

vi.mock('@/lib/runbooks/pool-labels', () => ({ lockFleetConfiguration: vi.fn() }));
vi.mock('@/lib/runbooks/command-context', () => ({
  runRunbookCommand: (_client: unknown, fn: (client: Prisma.TransactionClient) => unknown) =>
    fn(tx as unknown as Prisma.TransactionClient),
  logRunbookCommandAudit: vi.fn(),
}));

import { revokeRunbookAgent } from '@/lib/runbooks/fleet-commands';

beforeEach(() => {
  vi.clearAllMocks();
  tx.runbookAgent.findUnique.mockResolvedValue({ id: 'agent-1', name: 'host-1' });
  tx.runbookAgent.findUniqueOrThrow.mockResolvedValue({ id: 'agent-1', status: 'REVOKED' });
});

describe('revokeRunbookAgent', () => {
  it('removes every pool membership, explicit ones included, so the pool size no longer counts it', async () => {
    tx.runbookAgent.updateMany.mockResolvedValue({ count: 1 });

    await revokeRunbookAgent('agent-1', 'admin-1');

    expect(tx.runbookAgentPoolMember.deleteMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1' },
    });
  });

  it('leaves memberships alone when the agent was already revoked', async () => {
    tx.runbookAgent.updateMany.mockResolvedValue({ count: 0 });

    await revokeRunbookAgent('agent-1', 'admin-1');

    expect(tx.runbookAgentPoolMember.deleteMany).not.toHaveBeenCalled();
  });
});
