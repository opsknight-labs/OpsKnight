import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/sla/stream/route';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

const session: Session = {
  user: { id: 'user-1', email: 'test@example.com' },
  expires: new Date(Date.now() + 3600000).toISOString(),
};

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Authentication expiry and recovery policies are covered in recovery-stream-policy.test.ts.
vi.mock('@/lib/authentication-policy', () => ({
  checkAuthenticationPolicy: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/rbac', () => ({
  assertCanReadServiceMetrics: vi.fn(),
  getUserPermissions: vi.fn(async () => ({ capabilities: [] })),
}));

vi.mock('@/lib/authentication-policy', () => ({
  checkAuthenticationPolicy: vi.fn(async () => ({ allowed: true })),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    rateLimit: {
      upsert: vi.fn().mockResolvedValue({ count: 1, resetAt: new Date(Date.now() + 60000) }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SLA Streaming API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/sla/stream');
    const response = await GET(req);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns streaming response with correct headers', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(session);

    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.count).mockResolvedValue(0);
    vi.mocked(prisma.incident.findMany).mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/sla/stream');
    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('streams incidents in batches', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(session);

    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.count).mockResolvedValue(2);

    const mockIncidents = [
      { id: 'inc-1', title: 'Incident 1', status: 'OPEN', createdAt: new Date() },
      { id: 'inc-2', title: 'Incident 2', status: 'RESOLVED', createdAt: new Date() },
    ];

    vi.mocked(prisma.incident.findMany)
      .mockResolvedValueOnce(
        mockIncidents as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>
      )
      .mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/sla/stream');
    const response = await GET(req);

    expect(response.status).toBe(200);

    // Read stream content
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullContent += decoder.decode(value, { stream: true });
      }
    }

    // Verify stream contains metadata and batch
    expect(fullContent).toContain('data:');
    expect(fullContent).toContain('"type":"meta"');
    expect(fullContent).toContain('"totalCount":2');
  });

  it('respects serviceId query parameter for filtering', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(session);

    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.count).mockResolvedValue(0);
    vi.mocked(prisma.incident.findMany).mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/sla/stream?serviceId=svc-123');
    await GET(req);

    expect(prisma.incident.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serviceId: 'svc-123',
        }),
      })
    );
  });

  it('returns 403 instead of streaming global data when scope authorization fails', async () => {
    const { getServerSession } = await import('next-auth');
    const { assertCanReadServiceMetrics } = await import('@/lib/rbac');
    vi.mocked(getServerSession).mockResolvedValue(session);
    vi.mocked(assertCanReadServiceMetrics).mockRejectedValueOnce(
      new Error('Unauthorized. Specify serviceId or teamId to view metrics.')
    );

    const req = new NextRequest('http://localhost:3000/api/sla/stream?windowDays=30');
    const response = await GET(req);

    expect(response.status).toBe(403);
    const { default: prisma } = await import('@/lib/prisma');
    expect(prisma.incident.count).not.toHaveBeenCalled();
  });
  it('redacts protected incident titles in an authorized SSE batch', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(session);
    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.count).mockResolvedValue(1);
    vi.mocked(prisma.incident.findMany)
      .mockResolvedValueOnce([
        {
          id: 'private',
          title: 'Customer ABC123 payment failure',
          status: 'OPEN',
          createdAt: new Date(),
          automationDecision: { incidentId: 'private' },
          automationTraces: [],
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>)
      .mockResolvedValueOnce([]);
    const response = await GET(new NextRequest('http://localhost:3000/api/sla/stream'));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Restricted alert content');
    expect(body).not.toContain('ABC123');
    expect(body).not.toContain('automationDecision');
  });
});
