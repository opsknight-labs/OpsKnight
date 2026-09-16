import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
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
    user: { delete: vi.fn().mockResolvedValue({ id: 'subject-1' }) },
  };

  const privacyRequestFindUnique = vi.fn();
  const privacyRequestUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const executionFindUnique = vi.fn();
  const executionUpsert = vi.fn();
  const executionUpdate = vi.fn();
  const userFindUnique = vi.fn();
  const auditCreate = vi.fn().mockResolvedValue(undefined);

  const mockPrisma = {
    privacyRequest: { findUnique: privacyRequestFindUnique, updateMany: privacyRequestUpdateMany },
    privacyErasureExecution: {
      findUnique: executionFindUnique,
      upsert: executionUpsert,
      update: executionUpdate,
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

  return {
    tx,
    privacyRequestFindUnique,
    privacyRequestUpdateMany,
    executionFindUnique,
    executionUpsert,
    executionUpdate,
    userFindUnique,
    auditCreate,
    mockPrisma,
    buildSubjectErasurePlan,
    verifySubjectErasure,
    acquireAdvisoryLock,
    runSerializableTransaction,
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
    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(mocks.tx)
    );
    mocks.userFindUnique.mockResolvedValue({ email: 'alice@example.com', name: 'Alice' });
    mocks.privacyRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.executionUpsert.mockResolvedValue({ id: 'exec-1', status: 'RUNNING' });
    mocks.executionUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'exec-1',
        ...data,
      })
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
    mocks.executionFindUnique.mockResolvedValue(null);

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
    });
  });

  it('is idempotent: a second call against an already-COMPLETED execution is a safe no-op', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.executionFindUnique.mockResolvedValue({
      id: 'exec-1',
      status: 'COMPLETED',
      resultSummary: { userProfile: 1 },
    });

    const result = await executeErasure(REQUEST_ID, ACTOR);

    expect(result).toEqual({
      executionId: 'exec-1',
      status: 'COMPLETED',
      domainCounts: { userProfile: 1 },
    });
    expect(mocks.buildSubjectErasurePlan).not.toHaveBeenCalled();
    expect(mocks.runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('refuses to run before identity verification / outside PROCESSING', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ verifiedAt: null }));
    mocks.executionFindUnique.mockResolvedValue(null);

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_PREREQUISITES_NOT_MET',
    });
    expect(mocks.buildSubjectErasurePlan).not.toHaveBeenCalled();
  });

  it('blocks execution and marks the execution FAILED when the plan has blocking conditions', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.executionFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(
      eligiblePlan({
        canExecute: false,
        blockingConditions: ['Still assigned to 1 active incident(s).'],
      })
    );

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_BLOCKED',
    });

    expect(mocks.runSerializableTransaction).not.toHaveBeenCalled();
    expect(mocks.executionUpdate).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: { status: 'FAILED', failureCode: 'BLOCKED' },
    });
    const actions = mocks.auditCreate.mock.calls.map(call => call[0].data.action);
    expect(actions).toEqual(['privacy.erasure.started', 'privacy.erasure.failed']);
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
    mocks.executionFindUnique.mockResolvedValue(null);
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
    mocks.executionFindUnique.mockResolvedValue(null);
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
    mocks.executionFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(eligiblePlan());
    mocks.verifySubjectErasure.mockResolvedValue({ verified: true, issues: [] });

    await executeErasure(REQUEST_ID, ACTOR);

    expect(mocks.tx.user.delete).toHaveBeenCalledWith({ where: { id: SUBJECT_ID } });
    expect(mocks.privacyRequestUpdateMany).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    const actions = mocks.auditCreate.mock.calls.map(call => call[0].data.action);
    expect(actions).toEqual([
      'privacy.erasure.started',
      'privacy.erasure.completed',
      'privacy.request.completed',
    ]);
  });

  it('marks the execution PARTIAL and does not complete the request when post-execution verification fails', async () => {
    mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
    mocks.executionFindUnique.mockResolvedValue(null);
    mocks.buildSubjectErasurePlan.mockResolvedValue(eligiblePlan());
    mocks.verifySubjectErasure.mockResolvedValue({
      verified: false,
      issues: ['User row still exists.'],
    });

    await expect(executeErasure(REQUEST_ID, ACTOR)).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_BLOCKED',
    });

    expect(mocks.executionUpdate).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: expect.objectContaining({ status: 'PARTIAL', failureCode: 'VERIFICATION_FAILED' }),
    });
    expect(mocks.privacyRequestUpdateMany).not.toHaveBeenCalled();
  });
});
