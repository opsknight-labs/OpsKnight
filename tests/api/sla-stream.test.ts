import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/sla/stream/route';
import { NextRequest } from 'next/server';

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
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
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'test@example.com' },
    } as any);

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
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'test@example.com' },
    } as any);

    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incident.count).mockResolvedValue(2);

    const mockIncidents = [
      { id: 'inc-1', title: 'Incident 1', status: 'OPEN', createdAt: new Date() },
      { id: 'inc-2', title: 'Incident 2', status: 'RESOLVED', createdAt: new Date() },
    ];

    vi.mocked(prisma.incident.findMany)
      .mockResolvedValueOnce(mockIncidents as any)
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
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'test@example.com' },
    } as any);

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
});
