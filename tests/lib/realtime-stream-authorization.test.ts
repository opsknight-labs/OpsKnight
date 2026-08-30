import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: mocks.findUnique } },
}));

import {
  hasSameStreamAuthorizationScope,
  resolveStreamAuthorization,
} from '@/lib/realtime-stream-authorization';

describe('realtime stream authorization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a stream after its session token has been revoked', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      tokenVersion: 4,
      teamMemberships: [{ teamId: 'team-1' }],
    });

    await expect(resolveStreamAuthorization('user-1', 3)).resolves.toBeNull();
  });

  it.each([
    ['a disabled account', { status: 'DISABLED', role: 'USER', tokenVersion: 3 }],
    ['a role change', { status: 'ACTIVE', role: 'NOT_A_ROLE', tokenVersion: 3 }],
  ])('rejects %s during stream revalidation', async (_label, update) => {
    mocks.findUnique.mockResolvedValue({
      id: 'user-1',
      ...update,
      teamMemberships: [{ teamId: 'team-1' }],
    });

    await expect(resolveStreamAuthorization('user-1', 3)).resolves.toBeNull();
  });

  it('detects team membership changes in an open stream', () => {
    const current = {
      id: 'user-1',
      role: 'USER' as const,
      status: 'ACTIVE' as const,
      tokenVersion: 3,
      teamIds: ['team-1'],
    };
    const afterRemoval = { ...current, teamIds: [] };

    expect(hasSameStreamAuthorizationScope(current, afterRemoval)).toBe(false);
  });

  it('keeps an unchanged active authorization scope connected', () => {
    const current = {
      id: 'user-1',
      role: 'USER' as const,
      status: 'ACTIVE' as const,
      tokenVersion: 3,
      teamIds: ['team-1', 'team-2'],
    };

    expect(hasSameStreamAuthorizationScope(current, { ...current, teamIds: ['team-2', 'team-1'] })).toBe(
      true
    );
  });
});
