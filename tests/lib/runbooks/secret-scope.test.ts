import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(async (value: string) => `plain:${value}`),
}));

import { agentCanResolveSecretInputs, resolveSecretInputValues } from '@/lib/runbooks/secrets';

describe('Runbook secret execution scope', () => {
  it('queries only grants for the claiming Agent or resolved target pool', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ name: 'database-password', valueEncrypted: 'ciphertext' }]);
    const result = await resolveSecretInputValues(
      { password: 'secret://database-password', region: 'us-east-1' },
      { agentId: 'agent-1', targetAgentPoolId: 'pool-1' },
      { $queryRaw: vi.fn().mockResolvedValue([]), runbookSecret: { findMany } } as never
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
        $queryRaw: vi.fn().mockResolvedValue([]),
        runbookSecret: { findMany: vi.fn().mockResolvedValue([]) },
      } as never)
    ).rejects.toThrow('not granted to this Agent or execution pool');
  });

  it('lets a claiming agent check grant coverage before it claims, so it can skip the attempt', async () => {
    const count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const tx = { runbookSecret: { count } } as never;
    const values = { a: 'secret://one', b: 'secret://two', region: 'eu' };
    const scope = { agentId: 'agent-2', targetAgentPoolId: 'pool-1' };

    await expect(agentCanResolveSecretInputs(values, scope, tx)).resolves.toBe(false);
    await expect(agentCanResolveSecretInputs(values, scope, tx)).resolves.toBe(true);
    await expect(agentCanResolveSecretInputs({ region: 'eu' }, scope, tx)).resolves.toBe(true);
    expect(count).toHaveBeenCalledTimes(2);
    expect(count.mock.calls[0][0].where.grants.some.OR).toContainEqual({ agentId: 'agent-2' });
  });
});
