import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { executeErasure } from '@/lib/privacy/erasure/execute';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

function appErrorCodes(results: PromiseSettledResult<unknown>[]) {
  return results.flatMap(result => {
    if (result.status !== 'rejected' || !isAppError(result.reason)) return [];
    return [result.reason.code];
  });
}

async function createProcessingErasureRequest(subjectId: string, actorId: string) {
  return testPrisma.privacyRequest.create({
    data: {
      subjectType: 'USER',
      subjectId,
      requestType: 'ERASURE',
      status: 'PROCESSING',
      verifiedAt: new Date(),
      requestedById: actorId,
    },
  });
}

describeIfRealDB('privacy erasure concurrency (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('serializes concurrent erasures of the last two active admins — exactly one succeeds and one ACTIVE ADMIN remains', async () => {
    // Only two ADMINs exist in this database: the two erasure targets. The actor
    // is a non-ADMIN so the admin count is exactly 2 — after one erasure
    // succeeds only one ADMIN remains and the second erasure must be blocked by
    // the in-transaction last-admin revalidation (USER_ADMIN_INVARIANT +
    // discoverErasureBlockersTx). Using a third ADMIN as actor would leave 2
    // admins after one deletion and both erasures would incorrectly succeed.
    const [adminA, adminB, actor] = await Promise.all([
      createTestUser({ email: `erasure-admin-a-${Math.random().toString(36).slice(2)}@example.com`, role: 'ADMIN', status: 'ACTIVE' }),
      createTestUser({ email: `erasure-admin-b-${Math.random().toString(36).slice(2)}@example.com`, role: 'ADMIN', status: 'ACTIVE' }),
      createTestUser({ email: `erasure-actor-${Math.random().toString(36).slice(2)}@example.com`, role: 'USER', status: 'ACTIVE' }),
    ]);

    expect(await testPrisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(2);

    const [reqA, reqB] = await Promise.all([
      createProcessingErasureRequest(adminA.id, actor.id),
      createProcessingErasureRequest(adminB.id, actor.id),
    ]);

    const results = await Promise.allSettled([
      executeErasure(reqA.id, { id: actor.id }),
      executeErasure(reqB.id, { id: actor.id }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser must have been blocked by the last-admin invariant revalidated
    // inside the SERIALIZABLE destructive transaction, not silently deleted.
    expect(appErrorCodes(results)).toEqual(['PRIVACY_ERASURE_BLOCKED']);

    const remainingAdmins = await testPrisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    expect(remainingAdmins).toBe(1);

    // Exactly one of the two targets still exists; the actor (USER) is not counted.
    const aExists = await testPrisma.user.findUnique({ where: { id: adminA.id }, select: { id: true } });
    const bExists = await testPrisma.user.findUnique({ where: { id: adminB.id }, select: { id: true } });
    expect(Boolean(aExists) !== Boolean(bExists)).toBe(true);

    // The blocked request's execution must be FAILED/BLOCKED (not leaked RUNNING)
    // so a retry observes a terminal state.
    const failedExecutions = await testPrisma.privacyErasureExecution.findMany({
      where: { requestId: { in: [reqA.id, reqB.id] }, status: 'FAILED' },
      select: { requestId: true, failureCode: true },
    });
    expect(failedExecutions).toHaveLength(1);
    expect(failedExecutions[0].failureCode).toBe('BLOCKED');

    const completedExecutions = await testPrisma.privacyErasureExecution.findMany({
      where: { requestId: { in: [reqA.id, reqB.id] }, status: 'COMPLETED' },
      select: { requestId: true },
    });
    expect(completedExecutions).toHaveLength(1);
  });

  it('blocks erasure when an active/future on-call shift is created after the preview — shift survives', async () => {
    const [subject, actor] = await Promise.all([
      createTestUser({ email: `erasure-shift-subject-${Math.random().toString(36).slice(2)}@example.com`, role: 'USER', status: 'ACTIVE' }),
      createTestUser({ email: `erasure-shift-actor-${Math.random().toString(36).slice(2)}@example.com`, role: 'ADMIN', status: 'ACTIVE' }),
    ]);

    const request = await createProcessingErasureRequest(subject.id, actor.id);

    // Create an active/future shift for the subject after the request is already
    // in PROCESSING. In production this corresponds to a shift materialized
    // between buildSubjectErasurePlan() (preview) and the destructive
    // SERIALIZABLE transaction — the authoritative in-tx revalidation
    // (discoverErasureBlockersTx) must catch it and roll back with
    // PRIVACY_ERASURE_BLOCKED, leaving the shift intact.
    const schedule = await testPrisma.onCallSchedule.create({
      data: {
        name: `Erasure shift schedule ${Math.random().toString(36).slice(2)}`,
        timeZone: 'UTC',
      },
    });
    const shift = await testPrisma.onCallShift.create({
      data: {
        scheduleId: schedule.id,
        userId: subject.id,
        start: new Date(Date.now() - 60 * 60 * 1000),
        end: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await expect(executeErasure(request.id, { id: actor.id })).rejects.toMatchObject({
      code: 'PRIVACY_ERASURE_BLOCKED',
    });

    // Must not have deleted anything — transaction rolled back.
    expect(await testPrisma.user.findUnique({ where: { id: subject.id }, select: { id: true } })).not.toBeNull();
    expect(await testPrisma.onCallShift.findUnique({ where: { id: shift.id } })).not.toBeNull();

    const execution = await testPrisma.privacyErasureExecution.findUnique({ where: { requestId: request.id } });
    expect(execution?.status).toBe('FAILED');
    expect(execution?.failureCode).toBe('BLOCKED');
  });

  it('allows erasure when only historical (past) on-call shifts exist', async () => {
    const [subject, actor] = await Promise.all([
      createTestUser({ email: `erasure-hist-shift-${Math.random().toString(36).slice(2)}@example.com`, role: 'USER', status: 'ACTIVE' }),
      createTestUser({ email: `erasure-hist-actor-${Math.random().toString(36).slice(2)}@example.com`, role: 'ADMIN', status: 'ACTIVE' }),
    ]);

    const schedule = await testPrisma.onCallSchedule.create({
      data: { name: `Erasure hist schedule ${Math.random().toString(36).slice(2)}`, timeZone: 'UTC' },
    });
    // Historical shift: end in the past — must NOT block per policy.
    await testPrisma.onCallShift.create({
      data: {
        scheduleId: schedule.id,
        userId: subject.id,
        start: new Date(Date.now() - 48 * 60 * 60 * 1000),
        end: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    const request = await createProcessingErasureRequest(subject.id, actor.id);
    const result = await executeErasure(request.id, { id: actor.id });

    expect(result.status).toBe('COMPLETED');
    expect(await testPrisma.user.findUnique({ where: { id: subject.id } })).toBeNull();
    // Historical shift was deleted as part of erasure (DELETE strategy for historical rows).
    expect(await testPrisma.onCallShift.count({ where: { userId: subject.id } })).toBe(0);
  });
});
