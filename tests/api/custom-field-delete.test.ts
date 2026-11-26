import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    customField: { findUnique: vi.fn(), delete: vi.fn(), count: vi.fn() },
    customFieldValue: { count: vi.fn(), deleteMany: vi.fn() },
  };
  return { tx, emitAuditEvent: vi.fn() };
});

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'admin-1' } }) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: async () => ({}) }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: async () => ({ id: 'admin-1', email: 'a@example.com', name: 'Admin' }),
}));
vi.mock('@/lib/prisma', () => ({
  default: { $transaction: async (callback: (tx: typeof m.tx) => unknown) => callback(m.tx) },
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: m.emitAuditEvent }));
// Run the v2 handler directly, without the auth, rate-limit and idempotency wrapper.
vi.mock('@/lib/api-v2/endpoint', () => ({ defineV2Route: (config: unknown) => config }));
vi.mock('@/lib/api-v2', () => ({
  defineV2Route: (config: unknown) => config,
  logV2Audit: vi.fn(),
}));
vi.mock('@/lib/api-v2/concurrency', () => ({
  etagHeaders: () => ({}),
  requireRevisionIfMatch: () => 3,
}));

import { DELETE as deleteFromSettings } from '@/app/api/settings/custom-fields/[id]/route';
import { DELETE as deleteFromApi } from '@/app/api/v2/custom-fields/[id]/route';

const field = {
  id: 'cf-1',
  name: 'Region',
  key: 'region',
  type: 'TEXT',
  required: false,
  defaultValue: null,
  options: null,
  showInList: false,
  order: 0,
  revision: 3,
};

describe('deleting a custom field that has stored values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.customField.findUnique.mockResolvedValue(field);
    m.tx.customFieldValue.deleteMany.mockResolvedValue({ count: 4 });
  });

  it('the settings page removes the values with the field and audits how many', async () => {
    const response = await deleteFromSettings(
      new NextRequest('http://localhost/api/settings/custom-fields/cf-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'cf-1' }) }
    );

    expect(response.status).toBe(200);
    expect(m.tx.customFieldValue.deleteMany).toHaveBeenCalledWith({
      where: { customFieldId: 'cf-1' },
    });
    expect(m.tx.customField.delete).toHaveBeenCalledWith({ where: { id: 'cf-1' } });
    expect(m.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'custom_field.deleted',
        metadata: { cascade: 'customFieldValue', valuesDeleted: 4 },
      }),
      m.tx
    );
  });

  describe('the API', () => {
    type Handler = (args: Record<string, unknown>) => Promise<{ status: number }>;
    const handler = (deleteFromApi as unknown as { handler: Handler }).handler;
    const call = () =>
      handler({
        params: { id: 'cf-1' },
        actor: { id: 'u1' },
        apiKey: { id: 'k1' },
        req: {},
        tx: m.tx,
      });

    it('ignores values that were cleared to null and removes their empty rows', async () => {
      m.tx.customFieldValue.count.mockResolvedValue(0);

      await expect(call()).resolves.toMatchObject({ status: 204 });

      expect(m.tx.customFieldValue.count).toHaveBeenCalledWith({
        where: { customFieldId: 'cf-1', value: { not: null } },
      });
      expect(m.tx.customFieldValue.deleteMany).toHaveBeenCalled();
      expect(m.tx.customField.delete).toHaveBeenCalled();
    });

    it('still refuses while incidents hold a stored value', async () => {
      m.tx.customFieldValue.count.mockResolvedValue(2);

      await expect(call()).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
      expect(m.tx.customField.delete).not.toHaveBeenCalled();
    });
  });
});
