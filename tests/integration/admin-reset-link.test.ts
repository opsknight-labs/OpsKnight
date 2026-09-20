import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
  oidcConfig: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const mockAssertAdmin = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockIssuePasswordResetToken = vi.hoisted(() => vi.fn());
const mockIssueUserInviteToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rbac', () => ({
  assertAdmin: mockAssertAdmin,
}));

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/password-reset', () => ({
  checkRateLimit: mockCheckRateLimit,
  issuePasswordResetToken: mockIssuePasswordResetToken,
}));

vi.mock('@/lib/invitations', () => ({
  issueUserInviteToken: mockIssueUserInviteToken,
}));

vi.mock('@/lib/app-url', () => ({
  getAppUrl: vi.fn().mockResolvedValue('http://localhost:3000'),
  getAppUrlSync: vi.fn().mockReturnValue('http://localhost:3000'),
}));

import { POST } from '@/app/api/admin/generate-reset-link/route';

describe('API: Admin Generate Reset Link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAdmin.mockResolvedValue({
      id: 'admin-id',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    mockCheckRateLimit.mockResolvedValue(undefined);
    mockIssuePasswordResetToken.mockResolvedValue({
      token: 'admin-reset-token-12345678901234567890123456789012',
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-11T05:00:00.000Z'),
    });
    mockIssueUserInviteToken.mockResolvedValue({
      token: 'invite-token-12345678901234567890123456789012',
      inviteUrl:
        'http://localhost:3000/set-password#token=invite-token-12345678901234567890123456789012',
      expiresAt: new Date('2026-09-18T05:00:00.000Z'),
    });
    mockPrisma.$transaction.mockImplementation(async callback => callback(mockPrisma));
  });

  it('generates a fragment-based reset link without revoking sessions prematurely for active users', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target-id',
      email: 'target@example.com',
      status: 'ACTIVE',
    });

    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'target-id' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.link).toContain('/reset-password#token=');
    expect(data.link).not.toContain('?token=');
    expect(data.type).toBe('PASSWORD_RESET');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'target-id' },
      select: { id: true, email: true, status: true },
    });
    expect(mockIssuePasswordResetToken).toHaveBeenCalledWith({
      userId: 'target-id',
      email: 'target@example.com',
      metadata: { generatedBy: 'admin-id' },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('generates an invitation link pointing to set-password for invited users', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'invited-target-id',
      email: 'invited@example.com',
      status: 'INVITED',
    });

    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'invited-target-id' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.link).toContain('/set-password#token=');
    expect(data.type).toBe('INVITE');
    expect(mockIssueUserInviteToken).toHaveBeenCalledWith(
      'invited-target-id',
      'invited@example.com'
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('rejects generating a link for disabled users', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'disabled-target-id',
      email: 'disabled@example.com',
      status: 'DISABLED',
    });

    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'disabled-target-id' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('USER_DISABLED');
  });

  it('rejects non-admin users using the typed authorization contract', async () => {
    mockAssertAdmin.mockRejectedValue(
      new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Unauthorized. Admin access required.',
      })
    );

    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'target-id' }),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.code).toBe('AUTHORIZATION_DENIED');
  });

  it('maps password-reset rate limiting by typed code instead of matching error text', async () => {
    mockCheckRateLimit.mockRejectedValueOnce(
      new AppError({ code: 'RATE_LIMIT_EXCEEDED', userMessage: 'Too many requests' })
    );

    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'target-id' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.error).toBe('Too many requests');
    expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(data.retryable).toBe(true);
  });

  it('rejects malformed and oversized user ids at the API boundary', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'x'.repeat(129) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
