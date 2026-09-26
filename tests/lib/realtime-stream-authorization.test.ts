import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  isSessionActive: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: mocks.findUnique } },
}));

vi.mock('@/lib/session-registry', () => ({
  isSessionActive: mocks.isSessionActive,
}));

import {
  hasSameStreamAuthorizationScope,
  resolveStreamAuthorization,
} from '@/lib/realtime-stream-authorization';

describe('realtime stream authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSessionActive.mockResolvedValue(true);
  });

  it('rejects a stream if sessionJti is missing (enforcing canonical registry)', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      tokenVersion: 3,
      teamMemberships: [{ teamId: 'team-1' }],
    });

    // Without sessionJti, must return null (never bypass registry)
    await expect(resolveStreamAuthorization('user-1', 3, null)).resolves.toBeNull();
    await expect(resolveStreamAuthorization('user-1', 3, undefined)).resolves.toBeNull();
  });

  it('rejects a stream if session is revoked or expired in the registry', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      tokenVersion: 3,
      teamMemberships: [{ teamId: 'team-1' }],
    });
    mocks.isSessionActive.mockResolvedValue(false);

    await expect(resolveStreamAuthorization('user-1', 3, 'jti-revoked')).resolves.toBeNull();
  });

  it('fails closed and returns null when database query throws', async () => {
    mocks.findUnique.mockRejectedValue(new Error('Connection lost to Postgres'));

    await expect(resolveStreamAuthorization('user-1', 3, 'jti-valid')).resolves.toBeNull();
  });

  it('rejects a stream after its session token has been revoked', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      tokenVersion: 4,
      teamMemberships: [{ teamId: 'team-1' }],
    });

    await expect(resolveStreamAuthorization('user-1', 3, 'jti-valid')).resolves.toBeNull();
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

    await expect(resolveStreamAuthorization('user-1', 3, 'jti-valid')).resolves.toBeNull();
  });

  it('detects team membership changes in an open stream', () => {
    const current = {
      id: 'user-1',
      role: 'USER' as const,
      status: 'ACTIVE' as const,
      tokenVersion: 3,
      teamIds: ['team-1'],
      sessionJti: 'jti-valid',
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
      sessionJti: 'jti-valid',
    };

    expect(
      hasSameStreamAuthorizationScope(current, { ...current, teamIds: ['team-2', 'team-1'] })
    ).toBe(true);
  });
});
