import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(async (value: string) => `plain:${value}`),
}));

import { resolveSecretInputValues } from '@/lib/runbooks/secrets';

describe('Runbook secret execution scope', () => {
  it('queries only grants for the claiming Agent or resolved target pool', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ name: 'database-password', valueEncrypted: 'ciphertext' }]);
    const result = await resolveSecretInputValues(
      { password: 'secret://database-password', region: 'us-east-1' },
      { agentId: 'agent-1', targetAgentPoolId: 'pool-1' },
      { runbookSecret: { findMany } } as never
    );
    expect(result).toEqual({ password: 'plain:ciphertext', region: 'us-east-1' });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        name: { in: ['database-password'] },
        grants: {
          some: {
            OR: [
              { agentId: 'agent-1' },
              { agentPoolId: 'pool-1', agentPool: { members: { some: { agentId: 'agent-1' } } } },
            ],
          },
        },
      },
    });
  });

  it('does not fall back to an unscoped secret when no grant matches', async () => {
    await expect(
      resolveSecretInputValues({ token: 'secret://production-token' }, { agentId: 'agent-1' }, {
        runbookSecret: { findMany: vi.fn().mockResolvedValue([]) },
      } as never)
    ).rejects.toThrow('not granted to this Agent or execution pool');
  });
});
