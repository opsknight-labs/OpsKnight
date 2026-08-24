import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Use vi.hoisted to define mocks that will be available when vi.mock is hoisted
const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userToken: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
    count: vi.fn().mockResolvedValue(0), // For checkRateLimit
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
  oidcConfig: {
    findFirst: vi.fn(),
  },
}));
const mockAssertAdmin = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rbac', () => ({
  assertAdmin: mockAssertAdmin,
}));

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

// Mock app-url
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
      role: 'ADMIN',
      status: 'ACTIVE',
    });
  });

  it('generates a reset link for a valid user when called by an admin', async () => {
    // 1. Mock User Found
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target-id',
      email: 'target@example.com',
    });

    // 2. Create Request
    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'target-id' }),
    });

    // 3. Call API
    const res = await POST(req);
    const data = await res.json();

    // 4. Assertions
    expect(res.status).toBe(200);
    expect(data.link).toBeDefined();
    expect(data.link).toContain('/reset-password?token=');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'target-id' } });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-id' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(mockPrisma.userToken.create).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('rejects non-admin users', async () => {
    mockAssertAdmin.mockRejectedValue(new Error('Unauthorized. Admin access required.'));

    const req = new NextRequest('http://localhost:3000/api/admin/generate-reset-link', {
      method: 'POST',
      body: JSON.stringify({ userId: 'target-id' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
