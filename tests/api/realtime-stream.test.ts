import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
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
        const currentUser: Awaited<ReturnType<typeof getCurrentUser>> = {
            id: 'user-1',
            role: 'ADMIN',
            email: 'admin@example.com',
            name: 'Admin User',
            timeZone: 'UTC',
            status: 'ACTIVE',
            tokenVersion: 0,
        };
        const streamUser = {
            id: 'user-1',
            role: 'ADMIN',
            status: 'ACTIVE',
            tokenVersion: 0,
            teamMemberships: [],
        } satisfies Prisma.UserGetPayload<{
            select: {
                id: true;
                role: true;
                status: true;
                tokenVersion: true;
                teamMemberships: { select: { teamId: true } };
            };
        }>;
        vi.mocked(getCurrentUser).mockResolvedValue(currentUser);
        vi.mocked(prisma.user.findUnique).mockResolvedValue(streamUser as never);
        vi.mocked(prisma.incident.findMany).mockResolvedValue([]);
        vi.mocked(prisma.incident.count).mockResolvedValue(0);

        const req = new NextRequest('http://localhost:3000/api/realtime/stream', {
            signal: controller.signal,
        });
        const res = await GET(req);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');

        controller.abort();
    });
});
