import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deriveHoldStatus,
  isRetentionHeld,
  getActiveRetentionHolds,
  getRetentionHold,
  listRetentionHolds,
  createRetentionHold,
  releaseRetentionHold,
  assertResourceNotHeld,
} from '@/lib/retention/holds';

const { mockPrisma, mockEmitAuditEvent } = vi.hoisted(() => {
  const mockPrisma = {
    dataRetentionHold: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findUnique: vi.fn(),
    },
    privacyRequest: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    $transaction: vi.fn(async (callback: (tx: any) => unknown) => callback(mockPrisma)),
  };

  const mockEmitAuditEvent = vi.fn().mockResolvedValue(undefined);

  return { mockPrisma, mockEmitAuditEvent };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/audit', () => ({
  emitAuditEvent: mockEmitAuditEvent,
}));

describe('Retention Holds Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ acquired: true }]);
  });

  describe('deriveHoldStatus', () => {
    it('returns RELEASED when releasedAt is set', () => {
      const status = deriveHoldStatus({
        releasedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });
      expect(status).toBe('RELEASED');
    });

    it('returns EXPIRED when expiresAt is in the past and releasedAt is null', () => {
      const past = new Date(Date.now() - 100000);
      const status = deriveHoldStatus({
        releasedAt: null,
        expiresAt: past,
      });
      expect(status).toBe('EXPIRED');
    });

    it('returns ACTIVE when expiresAt is null and releasedAt is null', () => {
      const status = deriveHoldStatus({
        releasedAt: null,
        expiresAt: null,
      });
      expect(status).toBe('ACTIVE');
    });

    it('returns ACTIVE when expiresAt is in the future and releasedAt is null', () => {
      const future = new Date(Date.now() + 100000);
      const status = deriveHoldStatus({
        releasedAt: null,
        expiresAt: future,
      });
      expect(status).toBe('ACTIVE');
    });
  });

  describe('isRetentionHeld', () => {
    it('returns held: true when active holds exist', async () => {
      mockPrisma.dataRetentionHold.findMany.mockResolvedValueOnce([
        { id: 'hold-1' },
        { id: 'hold-2' },
      ]);
      const result = await isRetentionHeld(mockPrisma as any, 'USER', 'usr-1');
      expect(result.held).toBe(true);
      expect(result.activeHoldCount).toBe(2);
    });

    it('returns held: false when no active holds exist', async () => {
      mockPrisma.dataRetentionHold.findMany.mockResolvedValueOnce([]);
      const result = await isRetentionHeld(mockPrisma as any, 'INCIDENT', 'inc-1');
      expect(result.held).toBe(false);
      expect(result.activeHoldCount).toBe(0);
    });
  });

  describe('assertResourceNotHeld', () => {
    it('throws RETENTION_HOLD_BLOCKED when resource is held', async () => {
      mockPrisma.dataRetentionHold.findMany.mockResolvedValueOnce([{ id: 'hold-1' }]);
      await expect(assertResourceNotHeld(mockPrisma as any, 'USER', 'usr-1')).rejects.toMatchObject(
        {
          code: 'RETENTION_HOLD_BLOCKED',
          details: {
            scopeType: 'USER',
            scopeId: 'usr-1',
            activeHoldCount: 1,
          },
        }
      );
    });

    it('succeeds when resource is not held', async () => {
      mockPrisma.dataRetentionHold.findMany.mockResolvedValueOnce([]);
      await expect(
        assertResourceNotHeld(mockPrisma as any, 'USER', 'usr-1')
      ).resolves.toBeUndefined();
    });
  });

  describe('createRetentionHold', () => {
    it('throws when reason is empty or whitespace', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'usr-1' });

      await expect(
        createRetentionHold(
          {
            scopeType: 'USER',
            scopeId: 'usr-1',
            reason: '   ',
          },
          'admin-1'
        )
      ).rejects.toThrow('reason is required');
    });

    it('throws when expiresAt is in the past', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'usr-1' });

      await expect(
        createRetentionHold(
          {
            scopeType: 'USER',
            scopeId: 'usr-1',
            reason: 'Legal inquiry',
            expiresAt: new Date(Date.now() - 60000),
          },
          'admin-1'
        )
      ).rejects.toThrow('expiresAt must be in the future');
    });

    it('throws when target resource does not exist', async () => {
      mockPrisma.incident.findUnique.mockResolvedValue(null);

      await expect(
        createRetentionHold(
          {
            scopeType: 'INCIDENT',
            scopeId: 'non-existent-inc',
            reason: 'Litigation hold',
          },
          'admin-1'
        )
      ).rejects.toThrow('Resource INCIDENT:non-existent-inc not found');
    });

    it('creates hold and emits audit event with reasonProvided flag (no raw PII)', async () => {
      mockPrisma.incident.findUnique.mockResolvedValue({ id: 'inc-1' });
      const createdHold = {
        id: 'hold-123',
        scopeType: 'INCIDENT',
        scopeId: 'inc-1',
        reason: 'Sensitive legal investigation details',
        externalReference: 'LEGAL-456',
        createdById: 'admin-1',
        releasedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        releasedAt: null,
        createdBy: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
        releasedBy: null,
      };
      mockPrisma.dataRetentionHold.create.mockResolvedValue(createdHold);

      const result = await createRetentionHold(
        {
          scopeType: 'INCIDENT',
          scopeId: 'inc-1',
          reason: 'Sensitive legal investigation details',
          externalReference: 'LEGAL-456',
        },
        'admin-1'
      );

      expect(result.hold.id).toBe('hold-123');
      expect(result.hold.status).toBe('ACTIVE');

      // Verify audit event does NOT include raw sensitive reason text, and txClient is passed
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'retention.hold.created',
          target: { type: 'DATA_RETENTION_HOLD', id: 'hold-123' },
          actor: { type: 'USER', id: 'admin-1' },
          metadata: {
            scopeType: 'INCIDENT',
            scopeId: 'inc-1',
            reasonProvided: true,
            externalReferenceProvided: true,
          },
        }),
        expect.anything()
      );
      const auditCall = mockEmitAuditEvent.mock.calls[0][0];
      expect(JSON.stringify(auditCall.metadata)).not.toContain(
        'Sensitive legal investigation details'
      );
    });
  });

  describe('releaseRetentionHold', () => {
    it('releases active hold and emits audit event', async () => {
      const activeHold = {
        id: 'hold-1',
        scopeType: 'USER',
        scopeId: 'usr-1',
        reason: 'GDPR audit',
        externalReference: null,
        createdById: 'admin-1',
        releasedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        releasedAt: null,
        createdBy: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
        releasedBy: null,
      };
      mockPrisma.dataRetentionHold.findUnique.mockResolvedValue(activeHold);

      const releasedDate = new Date();
      mockPrisma.dataRetentionHold.update.mockResolvedValue({
        ...activeHold,
        releasedAt: releasedDate,
        releasedById: 'admin-2',
        releasedBy: { id: 'admin-2', name: 'Admin 2', email: 'admin2@example.com' },
      });

      const result = await releaseRetentionHold('hold-1', 'admin-2');

      expect(result.wasAlreadyReleased).toBe(false);
      expect(result.hold.status).toBe('RELEASED');
      expect(mockPrisma.dataRetentionHold.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hold-1' },
          data: expect.objectContaining({
            releasedById: 'admin-2',
          }),
        })
      );
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'retention.hold.released',
          target: { type: 'DATA_RETENTION_HOLD', id: 'hold-1' },
          metadata: expect.objectContaining({
            wasAlreadyReleased: false,
          }),
        }),
        expect.anything()
      );
    });

    it('is idempotent when hold is already released', async () => {
      const alreadyReleasedHold = {
        id: 'hold-1',
        scopeType: 'USER',
        scopeId: 'usr-1',
        reason: 'GDPR audit',
        externalReference: null,
        createdById: 'admin-1',
        releasedById: 'admin-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        releasedAt: new Date(Date.now() - 10000),
        createdBy: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
        releasedBy: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      };
      mockPrisma.dataRetentionHold.findUnique.mockResolvedValue(alreadyReleasedHold);

      const result = await releaseRetentionHold('hold-1', 'admin-2');

      expect(result.wasAlreadyReleased).toBe(true);
      expect(result.hold.status).toBe('RELEASED');
      expect(mockPrisma.dataRetentionHold.update).not.toHaveBeenCalled();
    });

    it('throws when hold is not found', async () => {
      mockPrisma.dataRetentionHold.findUnique.mockResolvedValue(null);
      await expect(releaseRetentionHold('non-existent', 'admin-1')).rejects.toThrow(
        'Retention hold non-existent not found'
      );
    });
  });

  describe('listRetentionHolds', () => {
    it('returns holds with derived status and pagination cursor', async () => {
      const holds = [
        {
          id: 'hold-1',
          scopeType: 'USER',
          scopeId: 'usr-1',
          reason: 'Hold 1',
          externalReference: null,
          createdById: 'admin-1',
          releasedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
          releasedAt: null,
          createdBy: null,
          releasedBy: null,
        },
        {
          id: 'hold-2',
          scopeType: 'USER',
          scopeId: 'usr-1',
          reason: 'Hold 2',
          externalReference: null,
          createdById: 'admin-1',
          releasedById: 'admin-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
          releasedAt: new Date(),
          createdBy: null,
          releasedBy: null,
        },
      ];
      mockPrisma.dataRetentionHold.findMany.mockResolvedValue(holds);

      const result = await listRetentionHolds(mockPrisma as any, { scopeType: 'USER', limit: 10 });
      expect(result.holds).toHaveLength(2);
      expect(result.holds[0].status).toBe('ACTIVE');
      expect(result.holds[1].status).toBe('RELEASED');
      expect(result.nextCursor).toBeNull();
    });
  });
});
