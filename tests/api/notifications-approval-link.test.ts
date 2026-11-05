import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/notifications/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    inAppNotification: { findMany: vi.fn(), count: vi.fn() },
  },
}));

describe('GET /api/notifications', () => {
  it('links an MCP approval notification to its review page', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'admin@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', timeZone: 'UTC' } as never);
    const createdAt = new Date('2026-11-04T12:00:00Z');
    vi.mocked(prisma.inAppNotification.findMany).mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        type: 'SYSTEM',
        title: 'Change waiting for your review',
        message: 'Rita asked the assistant "Claude" to: Update a service.',
        entityType: 'MCP_APPROVAL',
        entityId: 'cabc1234567890123456789012',
        readAt: null,
        createdAt,
      },
      {
        id: 'n2',
        userId: 'u1',
        type: 'INCIDENT',
        title: 'Incident',
        message: 'Database down',
        entityType: 'INCIDENT',
        entityId: 'inc1',
        readAt: null,
        createdAt,
      },
    ] as never);
    vi.mocked(prisma.inAppNotification.count).mockResolvedValue(2);
    const res = await GET(new NextRequest(new URL('http://localhost:3000/api/notifications')));
    const body = await res.json();
    const [approval, incident] = (body.data ?? body).notifications;
    expect(approval).toMatchObject({
      type: 'system',
      incidentId: null,
      href: '/settings/integrations/mcp/approvals/operations/cabc1234567890123456789012',
    });
    expect(incident).toMatchObject({ type: 'incident', incidentId: 'inc1', href: null });
  });
});
