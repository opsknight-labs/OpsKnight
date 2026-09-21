import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const auditCreate = vi.fn();
  const userFindUnique = vi.fn();
  const privacyRequestCreate = vi.fn();
  const privacyRequestFindUnique = vi.fn();
  const privacyRequestFindUniqueOrThrow = vi.fn();
  const privacyRequestUpdateMany = vi.fn();
  const privacyRequestUpdate = vi.fn();
  const privacyRequestFindMany = vi.fn();

  const mockPrisma = {
    auditLog: { create: auditCreate },
    user: { findUnique: userFindUnique },
    privacyRequest: {
      create: privacyRequestCreate,
      findUnique: privacyRequestFindUnique,
      findUniqueOrThrow: privacyRequestFindUniqueOrThrow,
      updateMany: privacyRequestUpdateMany,
      update: privacyRequestUpdate,
      findMany: privacyRequestFindMany,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(mockPrisma)),
  };

  return {
    auditCreate,
    userFindUnique,
    privacyRequestCreate,
    privacyRequestFindUnique,
    privacyRequestFindUniqueOrThrow,
    privacyRequestUpdateMany,
    privacyRequestUpdate,
    privacyRequestFindMany,
    mockPrisma,
  };
});

vi.mock('@/lib/prisma', () => ({ default: mocks.mockPrisma }));

import {
  assignPrivacyRequest,
  createPrivacyRequest,
  isAutomatedPrivacyRequestType,
  listPrivacyRequests,
  transitionPrivacyRequest,
} from '@/lib/privacy/requests';

const ACTOR = { id: 'cactor0000001' };

function baseRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'creq00000001',
    subjectType: 'USER',
    subjectId: 'user-1',
    requestType: 'ACCESS',
    status: 'RECEIVED',
    requestedAt: new Date('2026-09-01T00:00:00.000Z'),
    verifiedAt: null,
    completedAt: null,
    requestedById: 'cactor0000001',
    assignedToId: null,
    notes: null,
    rejectionReason: null,
    metadata: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('privacy request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: satisfies subject-existence checks, the audit actor snapshot
    // lookup, and assignee-eligibility checks unless a test overrides it.
    mocks.userFindUnique.mockResolvedValue({
      id: 'cuser00000001',
      email: 'actor@example.com',
      name: 'Actor',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
  });

  describe('isAutomatedPrivacyRequestType', () => {
    it('only ACCESS and PORTABILITY are automated', () => {
      expect(isAutomatedPrivacyRequestType('ACCESS')).toBe(true);
      expect(isAutomatedPrivacyRequestType('PORTABILITY')).toBe(true);
      expect(isAutomatedPrivacyRequestType('ERASURE')).toBe(false);
      expect(isAutomatedPrivacyRequestType('RECTIFICATION')).toBe(false);
      expect(isAutomatedPrivacyRequestType('RESTRICTION')).toBe(false);
      expect(isAutomatedPrivacyRequestType('OBJECTION')).toBe(false);
    });
  });

  describe('createPrivacyRequest', () => {
    it('creates a request in RECEIVED status and audits creation', async () => {
      const created = baseRequest();
      mocks.privacyRequestCreate.mockResolvedValue(created);

      const result = await createPrivacyRequest(
        { subjectType: 'USER', subjectId: 'user-1', requestType: 'ACCESS' },
        ACTOR
      );

      expect(result).toEqual(created);
      expect(mocks.privacyRequestCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subjectId: 'user-1',
          requestType: 'ACCESS',
          requestedById: 'cactor0000001',
        }),
      });
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'privacy.request.created',
            entityId: 'creq00000001',
          }),
        })
      );
    });

    it('rejects an unknown request type', async () => {
      await expect(
        createPrivacyRequest({ subjectId: 'user-1', requestType: 'BOGUS' }, ACTOR)
      ).rejects.toThrow();
      expect(mocks.privacyRequestCreate).not.toHaveBeenCalled();
    });

    it('rejects a USER subject that does not exist', async () => {
      mocks.userFindUnique.mockResolvedValueOnce(null);

      await expect(
        createPrivacyRequest(
          { subjectType: 'USER', subjectId: 'cuserMissing01', requestType: 'ACCESS' },
          ACTOR
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(mocks.privacyRequestCreate).not.toHaveBeenCalled();
    });
  });

  describe('transitionPrivacyRequest', () => {
    it('allows a valid transition and records old/new status in the audit event', async () => {
      const current = baseRequest({ status: 'IDENTITY_VERIFICATION' });
      const updated = baseRequest({ status: 'IN_REVIEW' });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(updated);

      const result = await transitionPrivacyRequest(
        { requestId: 'creq00000001', toStatus: 'IN_REVIEW' },
        ACTOR
      );

      expect(result.status).toBe('IN_REVIEW');
      expect(mocks.privacyRequestUpdateMany).toHaveBeenCalledWith({
        where: { id: 'creq00000001', status: 'IDENTITY_VERIFICATION' },
        data: expect.objectContaining({ status: 'IN_REVIEW' }),
      });
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'privacy.request.status_changed',
            details: expect.objectContaining({
              oldValue: { status: 'IDENTITY_VERIFICATION' },
              newValue: { status: 'IN_REVIEW' },
            }),
          }),
        })
      );
    });

    it('stamps verifiedAt only on a successful IDENTITY_VERIFICATION -> IN_REVIEW transition', async () => {
      const current = baseRequest({ status: 'IDENTITY_VERIFICATION', verifiedAt: null });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(
        baseRequest({ status: 'IN_REVIEW', verifiedAt: new Date() })
      );

      await transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'IN_REVIEW' }, ACTOR);

      expect(mocks.privacyRequestUpdateMany).toHaveBeenCalledWith({
        where: { id: 'creq00000001', status: 'IDENTITY_VERIFICATION' },
        data: expect.objectContaining({ verifiedAt: expect.any(Date) }),
      });
    });

    it('never stamps verifiedAt when identity verification is blocked or rejected', async () => {
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(baseRequest({ status: 'BLOCKED' }));

      mocks.privacyRequestFindUnique.mockResolvedValue(
        baseRequest({ status: 'IDENTITY_VERIFICATION', verifiedAt: null })
      );
      await transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'BLOCKED' }, ACTOR);
      let updateCall = mocks.privacyRequestUpdateMany.mock.calls.at(-1)![0];
      expect(updateCall.data).not.toHaveProperty('verifiedAt');

      mocks.privacyRequestFindUnique.mockResolvedValue(
        baseRequest({ status: 'IDENTITY_VERIFICATION', verifiedAt: null })
      );
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(baseRequest({ status: 'REJECTED' }));
      await transitionPrivacyRequest(
        {
          requestId: 'creq00000001',
          toStatus: 'REJECTED',
          rejectionReason: 'No response from subject',
        },
        ACTOR
      );
      updateCall = mocks.privacyRequestUpdateMany.mock.calls.at(-1)![0];
      expect(updateCall.data).not.toHaveProperty('verifiedAt');
    });

    it('rejects an invalid transition (e.g. RECEIVED -> COMPLETED)', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ status: 'RECEIVED' }));

      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'COMPLETED' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_INVALID_TRANSITION' });
      expect(mocks.privacyRequestUpdateMany).not.toHaveBeenCalled();
    });

    it('requires verification before processing and permits recovery to verification', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(
        baseRequest({ status: 'IN_REVIEW', verifiedAt: null })
      );
      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'PROCESSING' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_INVALID_TRANSITION' });

      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(
        baseRequest({ status: 'IDENTITY_VERIFICATION', verifiedAt: null })
      );
      await expect(
        transitionPrivacyRequest(
          { requestId: 'creq00000001', toStatus: 'IDENTITY_VERIFICATION' },
          ACTOR
        )
      ).resolves.toMatchObject({ status: 'IDENTITY_VERIFICATION' });
    });

    it('allows direct transition from IDENTITY_VERIFICATION to PROCESSING when identity is already verified', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(
        baseRequest({ status: 'IDENTITY_VERIFICATION', verifiedAt: new Date() })
      );
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(
        baseRequest({ status: 'PROCESSING', verifiedAt: new Date() })
      );

      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'PROCESSING' }, ACTOR)
      ).resolves.toMatchObject({ status: 'PROCESSING' });
    });

    it('never allows leaving a terminal COMPLETED request', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ status: 'COMPLETED' }));

      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'IN_REVIEW' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_INVALID_TRANSITION' });
    });

    it('never allows leaving a terminal REJECTED request', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ status: 'REJECTED' }));

      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'PROCESSING' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_INVALID_TRANSITION' });
    });

    it('treats a duplicate transition to the same status as a safe no-op', async () => {
      const current = baseRequest({ status: 'IN_REVIEW' });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);

      const result = await transitionPrivacyRequest(
        { requestId: 'creq00000001', toStatus: 'IN_REVIEW' },
        ACTOR
      );

      expect(result).toEqual(current);
      expect(mocks.privacyRequestUpdateMany).not.toHaveBeenCalled();
      expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('requires a rejection reason to reject a request', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ status: 'IN_REVIEW' }));

      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'REJECTED' }, ACTOR)
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(mocks.privacyRequestUpdateMany).not.toHaveBeenCalled();
    });

    it('stores the rejection reason and emits privacy.request.rejected', async () => {
      const current = baseRequest({ status: 'IN_REVIEW' });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(
        baseRequest({ status: 'REJECTED', rejectionReason: 'Cannot verify identity' })
      );

      await transitionPrivacyRequest(
        {
          requestId: 'creq00000001',
          toStatus: 'REJECTED',
          rejectionReason: 'Cannot verify identity',
        },
        ACTOR
      );

      expect(mocks.privacyRequestUpdateMany).toHaveBeenCalledWith({
        where: { id: 'creq00000001', status: 'IN_REVIEW' },
        data: expect.objectContaining({ rejectionReason: 'Cannot verify identity' }),
      });
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'privacy.request.rejected' }),
        })
      );
      // The free-text reason must never be copied into the longer-lived audit
      // trail — only that a reason was supplied.
      const auditPayload = JSON.stringify(mocks.auditCreate.mock.calls.at(-1));
      expect(auditPayload).toContain('reasonProvided');
      expect(auditPayload).not.toContain('Cannot verify identity');
    });

    it('emits privacy.request.completed and stamps completedAt when finishing processing', async () => {
      const current = baseRequest({ status: 'PROCESSING' });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(baseRequest({ status: 'COMPLETED' }));

      await transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'COMPLETED' }, ACTOR);

      expect(mocks.privacyRequestUpdateMany).toHaveBeenCalledWith({
        where: { id: 'creq00000001', status: 'PROCESSING' },
        data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
      });
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'privacy.request.completed' }),
        })
      );
    });

    it('raises a state conflict when another writer already changed the status (race safety)', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(
        baseRequest({ status: 'IDENTITY_VERIFICATION' })
      );
      // Someone else moved it first: the optimistic-lock updateMany matches 0 rows.
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 0 });

      await expect(
        transitionPrivacyRequest({ requestId: 'creq00000001', toStatus: 'IN_REVIEW' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_STATE_CONFLICT' });
    });

    it('throws PRIVACY_REQUEST_NOT_FOUND for an unknown request id', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(null);

      await expect(
        transitionPrivacyRequest({ requestId: 'creqmissing01', toStatus: 'IN_REVIEW' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
    });

    it('never accepts a payload that changes the request subject', async () => {
      const current = baseRequest({ status: 'IDENTITY_VERIFICATION', subjectId: 'user-1' });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);
      mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
      mocks.privacyRequestFindUniqueOrThrow.mockResolvedValue(baseRequest({ status: 'IN_REVIEW' }));

      await transitionPrivacyRequest(
        // subjectId is not part of the transition schema, so even if a caller
        // stuffs it into the payload it is silently dropped, not applied.
        { requestId: 'creq00000001', toStatus: 'IN_REVIEW', subjectId: 'someone-else' },
        ACTOR
      );

      const updateCall = mocks.privacyRequestUpdateMany.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('subjectId');
    });
  });

  describe('assignPrivacyRequest', () => {
    it('reassigns ownership and audits the change', async () => {
      const current = baseRequest({ assignedToId: null });
      const updated = baseRequest({ assignedToId: 'cadmin0000002' });
      mocks.privacyRequestFindUnique.mockResolvedValue(current);
      mocks.privacyRequestUpdate.mockResolvedValue(updated);

      const result = await assignPrivacyRequest(
        { requestId: 'creq00000001', assignedToId: 'cadmin0000002' },
        ACTOR
      );

      expect(result.assignedToId).toBe('cadmin0000002');
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'privacy.request.assigned' }),
        })
      );
    });

    it('throws PRIVACY_REQUEST_NOT_FOUND when assigning an unknown request', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(null);

      await expect(
        assignPrivacyRequest({ requestId: 'creqmissing01', assignedToId: 'cadmin0000002' }, ACTOR)
      ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
    });

    it('refuses to assign to a user without privacy.requests.manage capability', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ assignedToId: null }));
      mocks.userFindUnique.mockResolvedValueOnce({
        id: 'cauditor000001',
        role: 'AUDITOR',
        status: 'ACTIVE',
      });

      await expect(
        assignPrivacyRequest({ requestId: 'creq00000001', assignedToId: 'cauditor000001' }, ACTOR)
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(mocks.privacyRequestUpdate).not.toHaveBeenCalled();
    });

    it('refuses to assign to a deactivated eligible user', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ assignedToId: null }));
      mocks.userFindUnique.mockResolvedValueOnce({
        id: 'cadmin0000003',
        role: 'ADMIN',
        status: 'DISABLED',
      });

      await expect(
        assignPrivacyRequest({ requestId: 'creq00000001', assignedToId: 'cadmin0000003' }, ACTOR)
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(mocks.privacyRequestUpdate).not.toHaveBeenCalled();
    });
  });

  describe('listPrivacyRequests', () => {
    it('requests one extra row to detect more pages and returns a nextCursor', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => baseRequest({ id: `creqpage0000${i}` }));
      mocks.privacyRequestFindMany.mockResolvedValue(rows);

      const { requests, nextCursor } = await listPrivacyRequests({ limit: 2 });

      expect(mocks.privacyRequestFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      );
      expect(requests).toHaveLength(2);
      expect(nextCursor).toBe(rows[1].id);
    });

    it('returns a null cursor when there is no further page', async () => {
      const rows = [baseRequest()];
      mocks.privacyRequestFindMany.mockResolvedValue(rows);

      const { requests, nextCursor } = await listPrivacyRequests({ limit: 50 });

      expect(requests).toHaveLength(1);
      expect(nextCursor).toBeNull();
    });
  });
});
