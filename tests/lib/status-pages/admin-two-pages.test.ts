import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    statusPage: {
      count: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new',
        ...data,
      })),
      findUnique: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
    },
    notification: { updateMany: vi.fn() },
  };
  const store = { revoke: vi.fn(), removeRoute: vi.fn() };
  return { tx, store, rebuild: vi.fn().mockResolvedValue(true) };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: { $transaction: (fn: (t: typeof m.tx) => unknown) => fn(m.tx) },
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/status-pages/serving-store', () => ({ getStatusPageServingStore: () => m.store }));
vi.mock('@/lib/status-pages/snapshot', () => ({ rebuildStatusPageSnapshot: m.rebuild }));

import {
  createStatusPage,
  deleteStatusPage,
  MAX_STATUS_PAGES,
  StatusPageAdminError,
} from '@/lib/status-pages/admin';

describe('two status pages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows exactly two pages', () => {
    expect(MAX_STATUS_PAGES).toBe(2);
  });

  it('creates the second page as a non-default draft without touching the default', async () => {
    m.tx.statusPage.count.mockResolvedValue(1);
    const page = await createStatusPage({ name: 'Partners', slug: 'partners' });
    expect(page).toMatchObject({ slug: 'partners', isDefault: false, enabled: false });
    expect(m.tx.statusPage.updateMany).not.toHaveBeenCalled();
  });

  it('make-default on create keeps exactly one default', async () => {
    m.tx.statusPage.count.mockResolvedValue(1);
    const page = await createStatusPage({ name: 'Partners', slug: 'partners', makeDefault: true });
    expect(page.isDefault).toBe(true);
    expect(m.tx.statusPage.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  });

  it('refuses a third page with a clear message', async () => {
    m.tx.statusPage.count.mockResolvedValue(2);
    const error = await createStatusPage({ name: 'C', slug: 'c' }).catch(e => e);
    expect(error).toBeInstanceOf(StatusPageAdminError);
    expect(error.code).toBe('STATUS_PAGE_LIMIT_REACHED');
    expect(error.message).toContain('limit of 2 status pages');
    expect(m.tx.statusPage.create).not.toHaveBeenCalled();
  });

  it('deleting the default page promotes the remaining one', async () => {
    m.tx.statusPage.count.mockResolvedValue(2);
    m.tx.statusPage.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'a'
        ? { id: 'a', isDefault: true, enabled: true, slug: null }
        : { id: 'b', isDefault: false, enabled: true, slug: 'partners' }
    );
    m.tx.statusPage.findFirstOrThrow.mockResolvedValue({ id: 'b' });
    await deleteStatusPage('a');
    expect(m.tx.statusPage.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { isDefault: true },
    });
    expect(m.rebuild).toHaveBeenCalledWith('b');
  });

  it('deleting the non-default page leaves the default alone', async () => {
    m.tx.statusPage.count.mockResolvedValue(2);
    m.tx.statusPage.findUnique.mockResolvedValue({
      id: 'b',
      isDefault: false,
      enabled: true,
      slug: 'partners',
    });
    await deleteStatusPage('b');
    expect(m.tx.statusPage.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { isDefault: true } })
    );
    expect(m.rebuild).not.toHaveBeenCalled();
  });
});
