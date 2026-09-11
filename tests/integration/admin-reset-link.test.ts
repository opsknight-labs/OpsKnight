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
    mockPrisma.$transaction.mockImplementation(async callback => callback(mockPrisma));
  });

  it('generates a fragment-based reset link without revoking sessions prematurely', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target-id',
      email: 'target@example.com',
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
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'target-id' },
      select: { id: true, email: true },
    });
    expect(mockIssuePasswordResetToken).toHaveBeenCalledWith({
      userId: 'target-id',
      email: 'target@example.com',
      metadata: { generatedBy: 'admin-id' },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
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
