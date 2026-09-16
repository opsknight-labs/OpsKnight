import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  // Transaction client used by runSerializableTransaction
  const txPrivacyErasureFindUnique = vi.fn();
  const txPrivacyErasureCreate = vi.fn();
  const txPrivacyErasureUpdateMany = vi.fn();

  const txPrivacyRequestFindUnique = vi.fn().mockResolvedValue({
    status: 'PROCESSING',
    verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
  const txPrivacyErasureUpdate = vi.fn().mockResolvedValue({ id: 'exec-1' });

  const tx = {
    privacyRequest: { findUnique: txPrivacyRequestFindUnique },
    privacyErasureExecution: {
      findUnique: txPrivacyErasureFindUnique,
      create: txPrivacyErasureCreate,
      updateMany: txPrivacyErasureUpdateMany,
      update: txPrivacyErasureUpdate,
    },
    auditLog: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    teamMember: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    incidentWatcher: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    onCallShift: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    onCallLayerUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    onCallOverride: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    oidcConfig: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    slackIntegration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    slackOAuthConfig: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    notificationProvider: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    microsoftTeamsConfig: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    microsoftTeamsInstallation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    microsoftTeamsDestination: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    team: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    incidentNote: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    postmortem: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    incidentTemplate: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    actionItem: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    notification: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    incident: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    userToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };

  const privacyRequestFindUnique = vi.fn();
  const executionFindUnique = vi.fn();
  const executionFindUniqueOrThrow = vi.fn();
  const executionUpdate = vi.fn();
  const executionCreate = vi.fn();
  const userFindUnique = vi.fn();
  const auditCreate = vi.fn().mockResolvedValue(undefined);
  // For emitAuditEvent's actor snapshot lookup (it does user.findUnique via the
  // prisma client passed in)
  const auditUserFindUnique = vi.fn().mockResolvedValue(null);

  const mockPrisma = {
    privacyRequest: { findUnique: privacyRequestFindUnique },
    privacyErasureExecution: {
      findUnique: executionFindUnique,
      findUniqueOrThrow: executionFindUniqueOrThrow,
      update: executionUpdate,
      create: executionCreate,
    },
    user: { findUnique: userFindUnique },
    auditLog: { create: auditCreate },
  };

  const buildSubjectErasurePlan = vi.fn();
  const verifySubjectErasure = vi.fn();
  const acquireAdvisoryLock = vi.fn().mockResolvedValue(undefined);
  const runSerializableTransaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback(tx)
  );
  const transitionPrivacyRequest = vi.fn().mockResolvedValue({});
  const emitAuditEvent = vi.fn().mockResolvedValue(undefined);

  return {
    tx,
    txPrivacyErasureFindUnique,
    txPrivacyErasureCreate,
    txPrivacyErasureUpdateMany,
    txPrivacyRequestFindUnique,
    txPrivacyErasureUpdate,
    privacyRequestFindUnique,
    executionFindUnique,
    executionFindUniqueOrThrow,
    executionUpdate,
    executionCreate,
    userFindUnique,
    auditCreate,
    auditUserFindUnique,
    mockPrisma,
    buildSubjectErasurePlan,
    verifySubjectErasure,
    acquireAdvisoryLock,
    runSerializableTransaction,
    transitionPrivacyRequest,
    emitAuditEvent,
  };
});

vi.mock('@/lib/prisma', () => ({ default: mocks.mockPrisma }));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: mocks.runSerializableTransaction }));
vi.mock('@/lib/db-locks', () => ({
  acquireAdvisoryLock: mocks.acquireAdvisoryLock,
  LOCK_KEYS: { PRIVACY_ERASURE: BigInt(9141007) },
}));
vi.mock('@/lib/privacy/erasure/plan', () => ({
  buildSubjectErasurePlan: mocks.buildSubjectErasurePlan,
}));
vi.mock('@/lib/privacy/erasure/verify', () => ({
  verifySubjectErasure: mocks.verifySubjectErasure,
}));
vi.mock('@/lib/privacy/requests', () => ({
  transitionPrivacyRequest: mocks.transitionPrivacyRequest,
}));
vi.mock('@/lib/audit', () => ({
  emitAuditEvent: mocks.emitAuditEvent,
}));

import { executeErasure } from '@/lib/privacy/erasure/execute';

const ACTOR = { id: 'cactor0000001' };
const REQUEST_ID = 'creq00000001';
const SUBJECT_ID = 'cuserA0000001';

function baseRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REQUEST_ID,
    subjectType: 'USER',
    subjectId: SUBJECT_ID,
    requestType: 'ERASURE',
    status: 'PROCESSING',
    verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function eligiblePlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    subjectId: SUBJECT_ID,
    generatedAt: new Date().toISOString(),
    domains: [
      { id: 'assignedIncidents', label: 'x', strategy: 'ANONYMIZE', blocking: true, count: 1 },
      { id: 'auditLogSnapshots', label: 'x', strategy: 'ANONYMIZE', blocking: false, count: 2 },
    ],
    blockingConditions: [],
    canExecute: true,
    ...overrides,
  };
}

describe('executeErasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: claim path creates a fresh RUNNING execution
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.txPrivacyErasureCreate.mockResolvedValue({ id: 'exec-1', status: 'RUNNING' });
    mocks.txPrivacyErasureUpdateMany.mockResolvedValue({ count: 1 });
    mocks.executionFindUniqueOrThrow.mockResolvedValue({
      id: 'exec-1',
      status: 'RUNNING',
      resultSummary: {},
      manualReviewRequired: false,
      mutationCommittedAt: new Date(),
    });
    mocks.userFindUnique.mockResolvedValue({ email: 'alice@example.com', name: 'Alice' });
    // prisma.privacyErasureExecution.update is used for markClaimFailed,
    // pre-persisting resultSummary/manualReview, mutationCommittedAt,
    // and final COMPLETED.
    mocks.executionUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'exec-1',
        ...data,
      })
    );
    mocks.transitionPrivacyRequest.mockResolvedValue({});
    // reset tx leaf mocks that get .mock.calls inspected
    for (const bucket of [
      mocks.tx.auditLog,
      mocks.tx.teamMember,
      mocks.tx.incidentWatcher,
      mocks.tx.onCallShift,
      mocks.tx.onCallLayerUser,
      mocks.tx.onCallOverride,
      mocks.tx.oidcConfig,
      mocks.tx.slackIntegration,
      mocks.tx.slackOAuthConfig,
      mocks.tx.notificationProvider,
      mocks.tx.microsoftTeamsConfig,
      mocks.tx.microsoftTeamsInstallation,
      mocks.tx.microsoftTeamsDestination,
      mocks.tx.team,
      mocks.tx.incidentNote,
      mocks.tx.postmortem,
      mocks.tx.incidentTemplate,
      mocks.tx.actionItem,
      mocks.tx.notification,
      mocks.tx.incident,
      mocks.tx.userToken,
      mocks.tx.user,
    ]) {
      for (const fn of Object.values(bucket)) {
        if (typeof fn === 'function' && 'mockResolvedValue' in fn) {
          (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 } as never);
        }
      }
    }
    mocks.tx.user.deleteMany.mockResolvedValue({ count: 1 } as never);
    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(mocks.tx)
    );
  });

  it('throws PRIVACY_REQUEST_NOT_FOUND when the request does not exist', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(null);

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_REQUEST_NOT_FOUND',
    });
  });

  it('refuses a request whose type is not ERASURE', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ requestType: 'ACCESS' }));

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
    });
    expect(mocks.txPrivacyErasureFindUnique).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call against an already-COMPLETED execution is a safe no-op', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue({
      id: 'exec-1',
      status: 'COMPLETED',
      resultSummary: { userProfile: 1 },
      manualReviewRequired: false,
    });

    const result = await executeErasure(REQUEST_ID, ACTOR);

    expect(result).toEqual({
      executionId: 'exec-1',
      status: 'COMPLETED',
      domainCounts: { userProfile: 1 },
      manualReviewRequired: false,
    });
    expect(mocks.buildSubjectErasurePlan).not.toHaveBeenCalled();
    // Only the claim transaction ran — no destructive transaction
    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(1);
  });

  it('refuses to run before identity verification / outside PROCESSING', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ verifiedAt: null }));
    // claim succeeds so we reach the prerequisites check
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
    });
    expect(mocks.buildSubjectErasurePlan).not.toHaveBeenCalled();
    expect(mocks.executionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exec-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });

  it('blocks execution and marks the execution FAILED when the plan has blocking conditions', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(
      eligiblePlan({
        canExecute: false,
        blockingConditions: ['Still assigned to 1 active incident(s).'],
      })
    );

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_BLOCKED',
    });

    // No destructive transaction — only the claim transaction ran
    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.executionUpdate).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: { status: 'FAILED', failureCode: 'BLOCKED' },
    });
    const actions = mocks.emitAuditEvent.mock.calls.map(call => call[0].action);
    expect(actions).toEqual(
      expect.arrayContaining(['privacy.erasure.started', 'privacy.erasure.failed'])
    );
  });

  // --- The mandatory regression guarantee -----------------------------------
  // "Take an incident before erasure: Ack 7m, Resolve 45m, SLA breached: false.
  // Erase its former responder. After erasure: Ack 7m, Resolve 45m, SLA
  // breached: false." execute() must never include incident SLA/MTTA/MTTR
  // fields in its assignee-detach mutation — asserting the *exact* update
  // payload proves those fields are structurally impossible to have been
  // touched by this code path, independent of what a live DB does with them.
  it('detaches an erased responder from incidents without touching any SLA/MTTA/MTTR field', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(eligiblePlan());
    mocks.verifySubjectErasure.mockResolvedValue({ verified: true, issues: [] });

    const result = await executeErasure(REQUEST_ID, ACTOR);

    expect(result.status).toBe('COMPLETED');
    expect(mocks.tx.incident.updateMany).toHaveBeenCalledOnce();
    expect(mocks.tx.incident.updateMany).toHaveBeenCalledWith({
      where: { assigneeId: SUBJECT_ID },
      data: { assigneeId: null },
    });
    // No other field key ever appears in the mutation payload.
    const incidentUpdateData = mocks.tx.incident.updateMany.mock.calls[0][0].data;
    expect(Object.keys(incidentUpdateData)).toEqual(['assigneeId']);
    expect(incidentUpdateData).not.toHaveProperty('ackAt');
    expect(incidentUpdateData).not.toHaveProperty('resolvedAt');
    expect(incidentUpdateData).not.toHaveProperty('slaBreached');
    expect(incidentUpdateData).not.toHaveProperty('status');
    expect(incidentUpdateData).not.toHaveProperty('title');
  });

  it('scrubs the audit-log PII snapshot but never touches action/entityType/createdAt', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(eligiblePlan());
    mocks.verifySubjectErasure.mockResolvedValue({ verified: true, issues: [] });

    await executeErasure(REQUEST_ID, ACTOR);

    expect(mocks.tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { actorId: SUBJECT_ID },
      data: { actorEmail: null, actorName: null },
    });
    expect(mocks.tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { targetEmail: 'alice@example.com' },
      data: { targetEmail: null },
    });
    for (const call of mocks.tx.auditLog.updateMany.mock.calls) {
      const data = call[0].data as Record<string, unknown>;
      expect(data).not.toHaveProperty('action');
      expect(data).not.toHaveProperty('entityType');
      expect(data).not.toHaveProperty('createdAt');
    }
  });

  it('deletes the User row and transitions the request to COMPLETED on success', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(eligiblePlan());
    mocks.verifySubjectErasure.mockResolvedValue({ verified: true, issues: [] });

    await executeErasure(REQUEST_ID, ACTOR);

    expect(mocks.tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: SUBJECT_ID } });
    // Staged engine uses the canonical state machine, not a raw updateMany
    expect(mocks.transitionPrivacyRequest).toHaveBeenCalledWith(
      { requestId: REQUEST_ID, toStatus: 'COMPLETED' },
      ACTOR
    );
    // Structured recipient PII on Notification is nulled alongside userId
    expect(mocks.tx.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: SUBJECT_ID },
      data: { userId: null, recipientDisplay: null, recipientHash: null },
    });
    const actions = mocks.emitAuditEvent.mock.calls.map(call => call[0].action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'privacy.erasure.started',
        'privacy.erasure.completed',
      ])
    );
  });

  it('rolls back and reports FAILED/BLOCKED when in-transaction verification fails', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(eligiblePlan());
    mocks.verifySubjectErasure.mockResolvedValue({
      verified: false,
      issues: ['User row still exists.'],
    });

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_BLOCKED',
    });

    // Verification runs inside the transaction, so a failure rolls it back —
    // the execution is FAILED (retryable), NOT PARTIAL, and the request is
    // never transitioned.
    expect(mocks.executionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exec-1' },
        data: expect.objectContaining({ status: 'FAILED', failureCode: 'VERIFICATION_FAILED' }),
      })
    );
    expect(mocks.transitionPrivacyRequest).not.toHaveBeenCalled();
  });

  it('throws PRIVACY_ERASURE_IN_PROGRESS when a concurrent claim holds RUNNING', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue({
      id: 'exec-1',
      status: 'RUNNING',
      resultSummary: null,
      manualReviewRequired: false,
    });

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_IN_PROGRESS',
    });
    expect(mocks.buildSubjectErasurePlan).not.toHaveBeenCalled();
  });

  it('completes without auto-transitioning the request when manual review is required', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.txPrivacyErasureFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(
      eligiblePlan({
        domains: [
          {
            id: 'incidentNotes',
            label: 'x',
            strategy: 'DETACH',
            blocking: false,
            manualReviewRequired: true,
            count: 3,
          },
        ],
      })
    );
    mocks.verifySubjectErasure.mockResolvedValue({ verified: true, issues: [] });

    const result = await executeErasure(REQUEST_ID, ACTOR);
    expect(result.manualReviewRequired).toBe(true);
    expect(mocks.transitionPrivacyRequest).not.toHaveBeenCalled();
    expect(mocks.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.erasure.manual_review_required' })
    );
    // execution record reflects manualReviewRequired
    expect(mocks.executionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exec-1' },
        data: expect.objectContaining({ manualReviewRequired: true }),
      })
    );
  });
});
