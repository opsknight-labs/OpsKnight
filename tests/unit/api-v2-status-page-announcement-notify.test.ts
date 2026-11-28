import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  tx: {
    statusPageAnnouncement: { create: vi.fn() },
    backgroundJob: { create: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    statusPage: { findUnique: vi.fn().mockResolvedValue({ id: 'page-1' }) },
    statusPageService: { count: vi.fn() },
    statusPageBusinessService: { count: vi.fn() },
  },
}));
vi.mock('@/lib/api-v2/observability', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v2/observability')>()),
  withV2Observability: <T>(handler: T) => handler,
}));
vi.mock('@/lib/api-v2', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v2')>()),
  authenticateV2Request: vi
    .fn()
    .mockResolvedValue({ apiKey: { id: 'key' }, actor: { id: 'user' } }),
  enforceV2RateLimit: vi.fn().mockResolvedValue({}),
  enforceV2Authorization: vi.fn(),
  runV2IdempotentAuditedMutation: vi.fn(
    async (
      _req: unknown,
      _key: string,
      _scope: string,
      _body: unknown,
      execute: (tx: typeof mocks.tx) => Promise<unknown>
    ) => ({ value: await execute(mocks.tx), replayed: false })
  ),
}));

import { POST } from '@/app/api/v2/status-pages/[id]/announcements/route';

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/v2/status-pages/page-1/announcements', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'page-1' }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.statusPageAnnouncement.create.mockImplementation(async ({ data }) => ({
    id: 'ann-1',
    ...data,
  }));
});

describe('v2 status page announcement create', () => {
  it('queues the subscriber fan-out the console queues, in the same transaction', async () => {
    const response = await post({ title: 'Planned maintenance', message: 'Database upgrade' });

    expect(response.status).toBe(201);
    expect(mocks.tx.statusPageAnnouncement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notificationTiming: 'ON_PUBLISH', isActive: true }),
      })
    );
    expect(mocks.tx.backgroundJob.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: {
          announcementId: 'ann-1',
          statusPageId: 'page-1',
          notificationGeneration: 0,
          deliveryMode: 'ALL_ELIGIBLE',
        },
      }),
    });
  });

  it('sends nothing for an announcement created inactive', async () => {
    await post({ title: 'Draft notice', message: 'Not live yet', isActive: false });

    expect(mocks.tx.backgroundJob.create).not.toHaveBeenCalled();
  });
});
