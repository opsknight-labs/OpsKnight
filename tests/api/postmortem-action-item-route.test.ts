import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredActionItemId } from '@/lib/action-items';

const m = vi.hoisted(() => ({
  getItems: vi.fn(),
  replaceItems: vi.fn(),
  findFirst: vi.fn(),
}));

// Run the route handler directly, without the auth, rate-limit and idempotency wrapper.
vi.mock('@/lib/api-v2', () => ({
  defineV2Route: (config: unknown) => config,
  logV2Audit: vi.fn(),
}));
vi.mock('@/lib/api-v2/concurrency', () => ({
  etagHeaders: () => ({}),
  requireRevisionIfMatch: () => 1,
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/authorization-filters', () => ({ postmortemReadWhere: () => ({}) }));
vi.mock('@/lib/postmortems/authorization', () => ({
  assertPostmortemAccess: vi.fn(),
  postmortemEditWhere: () => ({}),
}));
vi.mock('@/lib/postmortems/action-item-commands', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/postmortems/action-item-commands')>()),
  getPostmortemActionItems: m.getItems,
  replacePostmortemActionItems: m.replaceItems,
}));

import { PATCH } from '@/app/api/v2/postmortems/[id]/action-items/[itemId]/route';

type Handler = (args: Record<string, unknown>) => Promise<{ data: { item?: { id: string } } }>;
const handler = (PATCH as unknown as { handler: Handler }).handler;

describe('PATCH a legacy-only postmortem action item', () => {
  const legacyId = 'postmortem-pm-1-0';
  const storedId = getStoredActionItemId({ postmortemId: 'pm-1', legacyId, index: 0 });

  beforeEach(() => {
    vi.clearAllMocks();
    m.findFirst.mockResolvedValue({ id: 'pm-1', incidentId: 'inc-1' });
  });

  it('returns the updated item under the id the first write stored it as', async () => {
    m.getItems.mockResolvedValue({
      postmortemId: 'pm-1',
      revision: 1,
      items: [
        { id: legacyId, title: 'Add alert', description: '', status: 'OPEN', priority: 'LOW' },
      ],
    });
    m.replaceItems.mockResolvedValue({
      revision: 2,
      items: [{ id: storedId, title: 'Add alert', status: 'IN_PROGRESS' }],
    });

    const result = await handler({
      params: { id: 'pm-1', itemId: legacyId },
      body: { status: 'IN_PROGRESS' },
      actor: { id: 'u1' },
      apiKey: { id: 'k1' },
      req: {},
      tx: { postmortem: { findFirst: m.findFirst } },
    });

    expect(storedId).not.toBe(legacyId);
    expect(result.data.item).toMatchObject({ id: storedId, status: 'IN_PROGRESS' });
  });

  it('keeps the requested id when the item is already stored as a row', async () => {
    m.getItems.mockResolvedValue({
      postmortemId: 'pm-1',
      revision: 1,
      items: [
        { id: 'row-1', title: 'Add alert', description: '', status: 'OPEN', priority: 'LOW' },
      ],
    });
    m.replaceItems.mockResolvedValue({
      revision: 2,
      items: [{ id: 'row-1', title: 'Add alert', status: 'COMPLETED' }],
    });

    const result = await handler({
      params: { id: 'pm-1', itemId: 'row-1' },
      body: { status: 'COMPLETED' },
      actor: { id: 'u1' },
      apiKey: { id: 'k1' },
      req: {},
      tx: { postmortem: { findFirst: m.findFirst } },
    });

    expect(result.data.item).toMatchObject({ id: 'row-1', status: 'COMPLETED' });
  });
});
