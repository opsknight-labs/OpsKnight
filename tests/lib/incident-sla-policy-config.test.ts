import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  service: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: mocks.permissions,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { saveIncidentSlaPolicy } from '@/lib/incident-sla/policy-config';
const input = {
  scopeKey: 'workspace',
  expectedVersion: 1,
  inheritWorkspace: false,
  baseAckTargetMs: 60000,
  baseResolveTargetMs: 120000,
  rules: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permissions.mockResolvedValue({
    id: 'admin',
    authenticated: true,
    capabilities: ['admin.manage'],
  });
  mocks.find.mockResolvedValue({ version: 1 });
  mocks.service.mockResolvedValue({ id: 's1' });
  mocks.create.mockResolvedValue({ id: 'v2', version: 2 });
  mocks.update.mockResolvedValue({ id: 'v2', version: 2, sealedAt: new Date() });
  mocks.transaction.mockImplementation(async callback =>
    callback({
      $queryRaw: mocks.lock,
      incidentSlaPolicy: { findFirst: mocks.find, create: mocks.create, update: mocks.update },
      auditLog: { create: mocks.audit },
      service: { findUnique: mocks.service },
    })
  );
});
describe('versioned SLA configuration commands', () => {
  it('locks scope, appends version, audits in transaction and revalidates', async () => {
    await saveIncidentSlaPolicy(input);
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.find.mock.invocationCallOrder[0]
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 2, scopeKey: 'workspace', createdById: 'admin' }),
      })
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v2' }, data: { sealedAt: expect.any(Date) } })
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'incident_sla.policy.version_created',
          actorId: 'admin',
          details: expect.objectContaining({
            actor: expect.objectContaining({ type: 'USER', id: 'admin' }),
          }),
        }),
      })
    );
    expect(mocks.revalidate).toHaveBeenCalledWith('/settings/incident-sla');
  });
  it('rejects stale concurrent edit rather than overwriting configuration', async () => {
    mocks.find.mockResolvedValue({ version: 2 });
    await expect(saveIncidentSlaPolicy(input)).rejects.toThrow('Reload');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('requires workspace admin for the workspace and for every service scope', async () => {
    mocks.permissions.mockResolvedValue({ id: 'reader', authenticated: true, capabilities: [] });
    await expect(saveIncidentSlaPolicy(input)).rejects.toThrow('Admin');
    // A responder on the owning team (operations.manage) could otherwise loosen the service targets.
    mocks.permissions.mockResolvedValue({
      id: 'responder',
      authenticated: true,
      capabilities: ['operations.manage'],
    });
    await expect(saveIncidentSlaPolicy({ ...input, scopeKey: 'service:s1' })).rejects.toThrow(
      'Admin'
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('validates before writing and propagates audit failures for rollback', async () => {
    await expect(saveIncidentSlaPolicy({ ...input, baseAckTargetMs: 0 })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.audit.mockRejectedValue(new Error('Audit failure'));
    await expect(saveIncidentSlaPolicy(input)).rejects.toThrow('Audit failure');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('allows a new explicit service inheritance version and preserves removed rule history', async () => {
    mocks.find.mockResolvedValue(null);
    await saveIncidentSlaPolicy({
      ...input,
      scopeKey: 'service:s1',
      expectedVersion: 0,
      inheritWorkspace: true,
      baseAckTargetMs: null,
      baseResolveTargetMs: null,
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          inheritWorkspace: true,
          rules: { create: [] },
        }),
      })
    );
  });
});
