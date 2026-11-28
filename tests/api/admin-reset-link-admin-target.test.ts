import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  assertAdmin: vi.fn(),
  assertRecentAuthentication: vi.fn(),
  issuePasswordResetToken: vi.fn(),
  createInAppNotifications: vi.fn(),
  emitAuditEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: mocks.assertAdmin,
  assertPermanentAdminForAdminTargets: vi.fn(),
}));
vi.mock('@/lib/access/step-up', () => ({
  assertRecentAuthentication: mocks.assertRecentAuthentication,
}));
vi.mock('@/lib/password-reset', () => ({
  checkRateLimit: vi.fn(),
  issuePasswordResetToken: mocks.issuePasswordResetToken,
}));
vi.mock('@/lib/invitations', () => ({ issueUserInviteToken: vi.fn() }));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: mocks.createInAppNotifications,
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: mocks.emitAuditEvent }));
vi.mock('@/lib/app-url', () => ({ getAppUrl: vi.fn().mockResolvedValue('http://localhost:3000') }));

import { POST } from '@/app/api/admin/generate-reset-link/route';

function request(userId: string) {
  return new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

describe('admin reset link for an administrator account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdmin.mockResolvedValue({ id: 'admin-1', email: 'a@x.io', name: 'Ada' });
    mocks.assertRecentAuthentication.mockResolvedValue(undefined);
    mocks.createInAppNotifications.mockResolvedValue(undefined);
    mocks.issuePasswordResetToken.mockResolvedValue({ token: 'tok-1' });
  });

  it('requires a fresh sign-in before minting a link for another admin', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-2',
      email: 'b@x.io',
      status: 'ACTIVE',
      role: 'ADMIN',
    });
    mocks.assertRecentAuthentication.mockRejectedValue(new AppError({ code: 'STEP_UP_REQUIRED' }));

    const res = await POST(request('admin-2'));

    expect(res.status).toBe(403);
    expect(mocks.issuePasswordResetToken).not.toHaveBeenCalled();
    expect(mocks.createInAppNotifications).not.toHaveBeenCalled();
  });

  it('notifies the target admin once the link is issued', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-2',
      email: 'b@x.io',
      status: 'ACTIVE',
      role: 'ADMIN',
    });

    const res = await POST(request('admin-2'));

    expect(res.status).toBe(200);
    expect(mocks.createInAppNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['admin-2'], type: 'SECURITY' })
    );
  });

  it('keeps the existing flow for non-admin targets', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-2',
      email: 'c@x.io',
      status: 'ACTIVE',
      role: 'USER',
    });

    const res = await POST(request('user-2'));

    expect(res.status).toBe(200);
    expect(mocks.assertRecentAuthentication).not.toHaveBeenCalled();
    expect(mocks.createInAppNotifications).not.toHaveBeenCalled();
  });
});
