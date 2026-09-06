import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueIncidentCreationSideEffects: vi.fn(),
  applyIncidentLifecycleCommand: vi.fn(),
  runSerializableTransaction: vi.fn(),
  prismaServiceUpdate: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  assertCanModifyService: vi.fn(),
}));

vi.mock('@/lib/event-outbox', () => ({
  enqueueIncidentCreationSideEffects: mocks.enqueueIncidentCreationSideEffects,
}));
vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleCommand: mocks.applyIncidentLifecycleCommand,
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));
vi.mock('@/lib/prisma', () => {
  const client = {
    service: {
      update: mocks.prismaServiceUpdate,
    },
  };
  return {
    default: client,
    prisma: client,
  };
});
vi.mock('@/lib/audit', () => ({
  logAudit: mocks.logAudit,
}));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn(),
  assertCanModifyService: mocks.assertCanModifyService,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { applyIncidentCreation } from '@/lib/incidents/creation';
import { updateServiceDefaultVisibility } from '@/app/(app)/services/actions';

type Tx = {
  service: { findUnique: ReturnType<typeof vi.fn> };
  customField: { findMany: ReturnType<typeof vi.fn> };
  incident: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  team: { findUnique: ReturnType<typeof vi.fn> };
  incidentNote: { create: ReturnType<typeof vi.fn> };
  incidentEvent: { create: ReturnType<typeof vi.fn> };
};

const NOW = new Date('2026-09-06T12:00:00.000Z');

function createTx(defaultVisibility?: 'PUBLIC' | 'PRIVATE' | null): Tx {
  return {
    service: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'svc-payments',
        defaultIncidentVisibility: defaultVisibility,
      }),
    },
    customField: { findMany: vi.fn().mockResolvedValue([]) },
    incident: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'inc-test-123' }),
    },
    user: { findUnique: vi.fn() },
    team: { findUnique: vi.fn() },
    incidentNote: { create: vi.fn().mockResolvedValue({}) },
    incidentEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function asTransactionClient(tx: Tx) {
  return tx as unknown as Parameters<typeof applyIncidentCreation>[0];
}

describe('Service Default Incident Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueIncidentCreationSideEffects.mockResolvedValue(undefined);
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-admin-1' });
    mocks.prismaServiceUpdate.mockResolvedValue({ id: 'svc-payments' });
  });

  describe('applyIncidentCreation inheritance & override', () => {
    it('inherits PRIVATE visibility when service defaults to PRIVATE and input omits visibility', async () => {
      const tx = createTx('PRIVATE');

      await applyIncidentCreation(asTransactionClient(tx), {
        title: 'Payment gateway timeout',
        serviceId: 'svc-payments',
        urgency: 'HIGH',
        source: 'WEB',
        now: NOW,
      });

      expect(tx.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceId: 'svc-payments',
            visibility: 'PRIVATE',
          }),
        })
      );
    });

    it('inherits PUBLIC visibility when service defaults to PUBLIC and input omits visibility', async () => {
      const tx = createTx('PUBLIC');

      await applyIncidentCreation(asTransactionClient(tx), {
        title: 'Public CDN degradation',
        serviceId: 'svc-payments',
        urgency: 'HIGH',
        source: 'WEB',
        now: NOW,
      });

      expect(tx.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceId: 'svc-payments',
            visibility: 'PUBLIC',
          }),
        })
      );
    });

    it('falls back to PUBLIC visibility when service has null/undefined defaultIncidentVisibility', async () => {
      const tx = createTx(null);

      await applyIncidentCreation(asTransactionClient(tx), {
        title: 'Legacy service degradation',
        serviceId: 'svc-payments',
        urgency: 'HIGH',
        source: 'WEB',
        now: NOW,
      });

      expect(tx.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceId: 'svc-payments',
            visibility: 'PUBLIC',
          }),
        })
      );
    });

    it('allows overriding service PRIVATE default to PUBLIC when explicitly chosen', async () => {
      const tx = createTx('PRIVATE');

      await applyIncidentCreation(asTransactionClient(tx), {
        title: 'User-facing banner outage',
        serviceId: 'svc-payments',
        urgency: 'HIGH',
        visibility: 'PUBLIC',
        source: 'WEB',
        now: NOW,
      });

      expect(tx.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceId: 'svc-payments',
            visibility: 'PUBLIC',
          }),
        })
      );
    });

    it('allows overriding service PUBLIC default to PRIVATE when explicitly chosen', async () => {
      const tx = createTx('PUBLIC');

      await applyIncidentCreation(asTransactionClient(tx), {
        title: 'Internal credentials rotated',
        serviceId: 'svc-payments',
        urgency: 'LOW',
        visibility: 'PRIVATE',
        source: 'WEB',
        now: NOW,
      });

      expect(tx.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceId: 'svc-payments',
            visibility: 'PRIVATE',
          }),
        })
      );
    });
  });

  describe('updateServiceDefaultVisibility action', () => {
    it('successfully updates defaultIncidentVisibility to PRIVATE and logs audit event', async () => {
      const result = await updateServiceDefaultVisibility('svc-payments', 'PRIVATE');

      expect(mocks.assertCanModifyService).toHaveBeenCalledWith('svc-payments');
      expect(mocks.prismaServiceUpdate).toHaveBeenCalledWith({
        where: { id: 'svc-payments' },
        data: { defaultIncidentVisibility: 'PRIVATE' },
      });
      expect(mocks.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'service.updated',
          entityType: 'SERVICE',
          entityId: 'svc-payments',
          actorId: 'user-admin-1',
          details: { defaultIncidentVisibility: 'PRIVATE' },
        })
      );
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/services/svc-payments');
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/services/svc-payments/settings');
      expect(result).toEqual({ success: true, visibility: 'PRIVATE' });
    });

    it('successfully updates defaultIncidentVisibility to PUBLIC', async () => {
      const result = await updateServiceDefaultVisibility('svc-payments', 'PUBLIC');

      expect(mocks.prismaServiceUpdate).toHaveBeenCalledWith({
        where: { id: 'svc-payments' },
        data: { defaultIncidentVisibility: 'PUBLIC' },
      });
      expect(result).toEqual({ success: true, visibility: 'PUBLIC' });
    });

    it('throws unauthorized error when user cannot modify service', async () => {
      mocks.assertCanModifyService.mockRejectedValueOnce(
        new Error('Unauthorized. You do not have permission.')
      );

      await expect(updateServiceDefaultVisibility('svc-payments', 'PRIVATE')).rejects.toThrow(
        'Unauthorized'
      );
      expect(mocks.prismaServiceUpdate).not.toHaveBeenCalled();
    });

    it('rejects invalid visibility setting', async () => {
      await expect(
        updateServiceDefaultVisibility('svc-payments', 'INVALID' as unknown as 'PUBLIC')
      ).rejects.toThrow('Invalid visibility setting');
      expect(mocks.prismaServiceUpdate).not.toHaveBeenCalled();
    });
  });
});
