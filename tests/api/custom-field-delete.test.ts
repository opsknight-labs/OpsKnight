import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    customField: { findUnique: vi.fn(), delete: vi.fn(), count: vi.fn() },
    customFieldValue: { count: vi.fn(), deleteMany: vi.fn() },
  };
  return { tx, emitAuditEvent: vi.fn(), logV2Audit: vi.fn() };
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
  logV2Audit: m.logV2Audit,
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
    const call = (query: { cascade?: 'true' | 'false' } = {}) =>
      handler({
        params: { id: 'cf-1' },
        query,
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

    it('still refuses while incidents hold a stored value, and says how to cascade', async () => {
      m.tx.customFieldValue.count.mockResolvedValue(2);

      for (const query of [{}, { cascade: 'false' as const }]) {
        await expect(call(query)).rejects.toMatchObject({
          code: 'RESOURCE_CONFLICT',
          userMessage: expect.stringContaining('cascade=true'),
        });
      }
      expect(m.tx.customFieldValue.deleteMany).not.toHaveBeenCalled();
      expect(m.tx.customField.delete).not.toHaveBeenCalled();
    });

    it('with cascade=true deletes the values and the field and audits valuesDeleted', async () => {
      m.tx.customFieldValue.count.mockResolvedValue(4);

      await expect(call({ cascade: 'true' })).resolves.toMatchObject({ status: 204 });

      expect(m.tx.customFieldValue.deleteMany).toHaveBeenCalledWith({
        where: { customFieldId: 'cf-1' },
      });
      expect(m.tx.customField.delete).toHaveBeenCalledWith({ where: { id: 'cf-1' } });
      expect(m.logV2Audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'custom_field.deleted',
          entityId: 'cf-1',
          details: { key: 'region', cascade: 'customFieldValue', valuesDeleted: 4 },
          tx: m.tx,
        })
      );
    });

    it('only accepts cascade as true or false', () => {
      const { querySchema } = deleteFromApi as unknown as {
        querySchema: { parse: (input: unknown) => unknown };
      };
      expect(querySchema.parse({})).toEqual({});
      expect(querySchema.parse({ cascade: 'true' })).toEqual({ cascade: 'true' });
      expect(() => querySchema.parse({ cascade: 'yes' })).toThrow();
      expect(() => querySchema.parse({ force: 'true' })).toThrow();
    });

    it('binds the cascade choice into the idempotency receipt', () => {
      const { idempotencyPayload } = deleteFromApi as unknown as {
        idempotencyPayload: (ctx: { req: { url: string } }) => unknown;
      };
      const payload = (url: string) => idempotencyPayload({ req: { url } });
      expect(payload('http://x/api/v2/custom-fields/cf-1')).toEqual({ cascade: false });
      expect(payload('http://x/api/v2/custom-fields/cf-1?cascade=false')).toEqual({ cascade: false });
      expect(payload('http://x/api/v2/custom-fields/cf-1?cascade=true')).toEqual({ cascade: true });
    });
  });
});
