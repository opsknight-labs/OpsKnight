import { beforeEach, describe, expect, it, vi } from 'vitest';

const revoke = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session-registry', () => ({ revokeRegisteredSession: revoke }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { revokeSessionForSignOut } from '@/lib/signout-session';

beforeEach(() => {
  vi.clearAllMocks();
  revoke.mockResolvedValue({ revoked: true, isCurrent: true });
});

describe('revokeSessionForSignOut', () => {
  it('ends the registered session of the token being signed out', async () => {
    await revokeSessionForSignOut({ sub: 'user-1', jti: 'jti-1' });

    expect(revoke).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'jti-1',
      currentJti: 'jti-1',
    });
  });

  it('does nothing for a token without a user or session id', async () => {
    await revokeSessionForSignOut({ sub: 'user-1' });
    await revokeSessionForSignOut({ jti: 'jti-1' });
    await revokeSessionForSignOut(null);

    expect(revoke).not.toHaveBeenCalled();
  });

  it('never stops the sign-out when the revocation fails', async () => {
    revoke.mockRejectedValue(new Error('database unavailable'));

    await expect(revokeSessionForSignOut({ sub: 'user-1', jti: 'jti-1' })).resolves.toBeUndefined();
  });
});
