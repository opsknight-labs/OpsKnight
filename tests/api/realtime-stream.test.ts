import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/realtime/stream/route';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';

vi.mock('@/lib/rbac', () => ({
    getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: vi.fn(),
        },
        incident: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
    },
}));

describe('API Route - Realtime Stream', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns SSE stream for authenticated users', async () => {
        const controller = new AbortController();
        vi.mocked(getCurrentUser).mockResolvedValue({
            id: 'user-1',
            role: 'ADMIN',
            tokenVersion: 0,
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: 'user-1',
            role: 'ADMIN',
            status: 'ACTIVE',
            tokenVersion: 0,
            teamMemberships: [],
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        vi.mocked(prisma.incident.findMany).mockResolvedValue([]);
        vi.mocked(prisma.incident.count).mockResolvedValue(0);

        const req = new NextRequest(new URL('http://localhost:3000/api/realtime/stream'), {
            signal: controller.signal,
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        const res = await GET(req);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');

        controller.abort();
    });
});
