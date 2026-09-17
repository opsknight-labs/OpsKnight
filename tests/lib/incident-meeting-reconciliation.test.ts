import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyMeetingOperationalHealth,
  reconcileIncidentMeeting,
  reconcileStalledMeetingProvisions,
  reconcileMeetingCleanupDebt,
  retryIncidentMeetingCleanup,
} from '@/lib/incident-collaboration/meeting-reconciliation';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => {
  return {
    default: {
      incidentMeeting: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      backgroundJob: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      incidentWarRoom: {
        findMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    },
  };
});

describe('Incident Meeting Reconciliation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyMeetingOperationalHealth', () => {
    it('classifies READY as HEALTHY', () => {
      const health = classifyMeetingOperationalHealth({
        state: 'READY',
        externalCleanupPending: false,
        hasActiveJob: false,
        ageMs: 1000,
      });
      expect(health).toBe('HEALTHY');
    });

    it('classifies CLOSED with externalCleanupPending as DRIFTED', () => {
      const health = classifyMeetingOperationalHealth({
        state: 'CLOSED',
        externalCleanupPending: true,
        hasActiveJob: false,
        ageMs: 5000,
      });
      expect(health).toBe('DRIFTED');
    });

    it('classifies CLOSED without cleanupPending as HEALTHY', () => {
      const health = classifyMeetingOperationalHealth({
        state: 'CLOSED',
        externalCleanupPending: false,
        hasActiveJob: false,
        ageMs: 5000,
      });
      expect(health).toBe('HEALTHY');
    });

    it('classifies FAILED with permission error as UNAVAILABLE', () => {
      const health = classifyMeetingOperationalHealth({
        state: 'FAILED',
        externalCleanupPending: false,
        hasActiveJob: false,
        lastErrorCode: 'PERMISSION_DENIED',
        ageMs: 5000,
      });
      expect(health).toBe('UNAVAILABLE');
    });

    it('classifies PROVISIONING with active job as HEALTHY transitional', () => {
      const health = classifyMeetingOperationalHealth({
        state: 'PROVISIONING',
        externalCleanupPending: false,
        hasActiveJob: true,
        ageMs: 2000,
      });
      expect(health).toBe('HEALTHY');
    });

    it('classifies PROVISIONING without active job past 15 minutes as DRIFTED', () => {
      const health = classifyMeetingOperationalHealth({
        state: 'PROVISIONING',
        externalCleanupPending: false,
        hasActiveJob: false,
        ageMs: 20 * 60 * 1000,
      });
      expect(health).toBe('DRIFTED');
    });
  });

  describe('reconcileIncidentMeeting', () => {
    it('detects orphaned PROVISIONING and transitions to FAILED', async () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const mockMeeting = {
        id: 'meet_test_1',
        incidentId: 'inc-123',
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'PROVISIONING',
        health: 'HEALTHY',
        provisioningToken: 'token-abc',
        provisioningStartedAt: thirtyMinutesAgo,
        createdAt: thirtyMinutesAgo,
        externalCleanupPending: false,
      };

      vi.mocked(prisma.incidentMeeting.findFirst).mockResolvedValue(mockMeeting as never);
      vi.mocked(prisma.backgroundJob.findMany).mockResolvedValue([]); // No active jobs
      vi.mocked(prisma.incidentMeeting.update).mockResolvedValue({
        ...mockMeeting,
        state: 'FAILED',
        health: 'UNAVAILABLE',
        lastErrorCode: 'ORPHANED_PROVISIONING',
      } as never);
      vi.mocked(prisma.incidentMeeting.findUnique).mockResolvedValue({
        ...mockMeeting,
        state: 'FAILED',
        health: 'UNAVAILABLE',
        lastErrorCode: 'ORPHANED_PROVISIONING',
      } as never);

      const result = await reconcileIncidentMeeting('inc-123');

      expect(result).not.toBeNull();
      expect(result?.healed).toBe(true);
      expect(result?.actionTaken).toBe('ORPHAN_PROVISIONING_FAILED');
      expect(result?.snapshot.state).toBe('FAILED');
      expect(result?.snapshot.health).toBe('DEGRADED');
      expect(prisma.incidentMeeting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'meet_test_1' },
          data: expect.objectContaining({
            state: 'FAILED',
            lastErrorCode: 'ORPHANED_PROVISIONING',
          }),
        })
      );
    });

    it('detects orphaned CLOSING and settles to CLOSED with externalCleanupPending', async () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const mockMeeting = {
        id: 'meet_test_closing',
        incidentId: 'inc-closing',
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSING',
        health: 'HEALTHY',
        createdAt: thirtyMinutesAgo,
        externalCleanupPending: false,
      };

      vi.mocked(prisma.incidentMeeting.findFirst).mockResolvedValue(mockMeeting as never);
      vi.mocked(prisma.backgroundJob.findMany).mockResolvedValue([]); // No active jobs
      vi.mocked(prisma.incidentMeeting.update).mockResolvedValue({
        ...mockMeeting,
        state: 'CLOSED',
        health: 'DEGRADED',
        externalCleanupPending: true,
        lastErrorCode: 'ORPHANED_CLOSING',
      } as never);
      vi.mocked(prisma.incidentMeeting.findUnique).mockResolvedValue({
        ...mockMeeting,
        state: 'CLOSED',
        health: 'DEGRADED',
        externalCleanupPending: true,
        lastErrorCode: 'ORPHANED_CLOSING',
      } as never);

      const result = await reconcileIncidentMeeting('inc-closing');

      expect(result).not.toBeNull();
      expect(result?.healed).toBe(true);
      expect(result?.actionTaken).toBe('ORPHAN_CLOSING_CLOSED');
      expect(result?.snapshot.state).toBe('CLOSED');
      expect(result?.snapshot.cleanupPending).toBe(true);
      expect(result?.snapshot.health).toBe('DRIFTED');
    });
  });

  describe('reconcileStalledMeetingProvisions', () => {
    it('batch reconciles stalled meetings in O(1) job lookup', async () => {
      const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
      vi.mocked(prisma.incidentMeeting.findMany).mockResolvedValue([
        {
          id: 'm1',
          incidentId: 'inc1',
          provider: 'MICROSOFT_TEAMS',
          generation: 1,
          provisioningToken: 'token-active',
          provisioningStartedAt: twentyMinAgo,
        },
        {
          id: 'm2',
          incidentId: 'inc2',
          provider: 'MICROSOFT_TEAMS',
          generation: 1,
          provisioningToken: 'token-orphaned',
          provisioningStartedAt: twentyMinAgo,
        },
      ] as never);

      // Only token-active has a background job
      vi.mocked(prisma.backgroundJob.findMany).mockResolvedValue([
        {
          type: 'MEETING_PROVISION',
          payload: { provisioningToken: 'token-active' },
        },
      ] as never);

      vi.mocked(prisma.incidentMeeting.updateMany).mockResolvedValue({ count: 1 });

      const recovered = await reconcileStalledMeetingProvisions();

      expect(recovered).toBe(1);
      expect(prisma.incidentMeeting.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'm2',
          state: 'PROVISIONING',
          provisioningToken: 'token-orphaned',
        },
        data: expect.objectContaining({
          state: 'FAILED',
          lastErrorCode: 'ORPHANED_PROVISIONING',
        }),
      });
    });
  });

  describe('reconcileMeetingCleanupDebt', () => {
    it('counts meetings with pending cleanup debt', async () => {
      vi.mocked(prisma.incidentMeeting.findMany).mockResolvedValue([
        { id: 'm1', provider: 'MICROSOFT_TEAMS', externalCleanupPending: true },
        { id: 'm2', provider: 'MICROSOFT_TEAMS', externalCleanupPending: true },
      ] as never);

      const count = await reconcileMeetingCleanupDebt();
      expect(count).toBe(2);
    });
  });

  describe('retryIncidentMeetingCleanup', () => {
    it('rejects if meeting is not CLOSED or has no cleanup debt', async () => {
      vi.mocked(prisma.incidentMeeting.findUnique).mockResolvedValue({
        id: 'm1',
        state: 'READY',
        externalCleanupPending: false,
      } as never);

      const result = await retryIncidentMeetingCleanup('m1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('cleanup debt');
    });

    it('enqueues MEETING_CLOSE job with reason external_cleanup_retry when valid', async () => {
      vi.mocked(prisma.incidentMeeting.findUnique).mockResolvedValue({
        id: 'm1',
        incidentId: 'inc-99',
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSED',
        externalCleanupPending: true,
        providerMeetingId: 'teams-meeting-99',
        organizerEmail: 'org@example.com',
      } as never);

      vi.mocked(prisma.backgroundJob.create).mockResolvedValue({ id: 'job-close-retry' } as never);
      vi.mocked(prisma.incidentMeeting.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.incidentMeeting.update).mockResolvedValue({} as never);

      const result = await retryIncidentMeetingCleanup('m1', 'admin-user-id');
      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-close-retry');

      expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'MEETING_CLOSE',
          payload: expect.objectContaining({
            incidentId: 'inc-99',
            reason: 'external_cleanup_retry',
          }),
        }),
      });
    });
  });
});
