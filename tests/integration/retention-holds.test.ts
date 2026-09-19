import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { executeErasure } from '@/lib/privacy/erasure/execute';
import { createRetentionHold, releaseRetentionHold } from '@/lib/retention/holds';
import { performDataCleanup } from '@/lib/data-cleanup';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

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

describeIfRealDB('retention holds integration (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('incident hold prevents cleanup of incident and its child events/notes, releasing allows cleanup', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Retention Test Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    // Create eligible incident (resolved > 30 days ago)
    const incident = await createTestIncident('Old Resolved Incident', service.id, {
      status: 'RESOLVED',
      createdAt: fortyDaysAgo,
      resolvedAt: thirtyFiveDaysAgo,
    });

    // Add incident note and event
    await testPrisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        userId: admin.id,
        content: 'Historical incident note',
        createdAt: thirtyFiveDaysAgo,
      },
    });

    await testPrisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: 'STATUS_CHANGE',
        message: 'Resolved incident',
        createdAt: thirtyFiveDaysAgo,
      },
    });

    // 1. Create retention hold on the incident
    const { hold } = await createRetentionHold(
      {
        scopeType: 'INCIDENT',
        scopeId: incident.id,
        reason: 'Litigation pending review',
        externalReference: 'LEGAL-101',
      },
      admin.id
    );

    expect(hold.status).toBe('ACTIVE');

    // 2. Perform cleanup with 30-day policy
    const policyOverride = { incidentRetentionDays: 30 };
    const dryRunResult = await performDataCleanup(true, policyOverride);
    expect(dryRunResult.incidents).toBe(0);
    expect(dryRunResult.held.incidents).toBe(1);

    const liveResult = await performDataCleanup(false, policyOverride);
    expect(liveResult.incidents).toBe(0);

    // Incident and its children still exist
    const incidentAfterHold = await testPrisma.incident.findUnique({
      where: { id: incident.id },
    });
    expect(incidentAfterHold).not.toBeNull();

    const noteCount = await testPrisma.incidentNote.count({
      where: { incidentId: incident.id },
    });
    expect(noteCount).toBe(1);

    // 3. Release the hold
    const releaseResult = await releaseRetentionHold(hold.id, admin.id);
    expect(releaseResult.wasAlreadyReleased).toBe(false);
    expect(releaseResult.hold.status).toBe('RELEASED');

    // 4. Cleanup again: now it should be deleted
    const postReleaseCleanup = await performDataCleanup(false, policyOverride);
    expect(postReleaseCleanup.incidents).toBe(1);

    const deletedIncident = await testPrisma.incident.findUnique({
      where: { id: incident.id },
    });
    expect(deletedIncident).toBeNull();

    const postCleanupNoteCount = await testPrisma.incidentNote.count({
      where: { incidentId: incident.id },
    });
    expect(postCleanupNoteCount).toBe(0);
  });

  it('user hold blocks privacy erasure (#690), and releasing allows erasure', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const targetUser = await createTestUser({ role: 'USER', status: 'ACTIVE' });

    // 1. Put user under retention hold
    const { hold } = await createRetentionHold(
      {
        scopeType: 'USER',
        scopeId: targetUser.id,
        reason: 'Regulatory compliance investigation',
        externalReference: 'REG-882',
      },
      admin.id
    );
    expect(hold.status).toBe('ACTIVE');

    // 2. Attempt erasure of the user
    const privacyRequest = await createProcessingErasureRequest(targetUser.id, admin.id);

    await expect(executeErasure(privacyRequest.id, { id: admin.id })).rejects.toSatisfy(
      (err: unknown) => {
        return isAppError(err) && err.code === 'PRIVACY_ERASURE_BLOCKED';
      }
    );

    // User is still present
    const userStillExists = await testPrisma.user.findUnique({
      where: { id: targetUser.id },
    });
    expect(userStillExists).not.toBeNull();

    // 3. Release the hold
    await releaseRetentionHold(hold.id, admin.id);

    // 4. Re-create a fresh processing erasure request and re-run erasure
    const freshPrivacyRequest = await createProcessingErasureRequest(targetUser.id, admin.id);
    const result = await executeErasure(freshPrivacyRequest.id, { id: admin.id });

    expect(result.status).toBe('COMPLETED');

    const erasedUser = await testPrisma.user.findUnique({
      where: { id: targetUser.id },
    });
    expect(erasedUser).toBeNull();
  });

  it('multiple holds on a single resource requires all holds to be released before deletion', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Multi-Hold Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const incident = await createTestIncident('Multi-Hold Incident', service.id, {
      status: 'RESOLVED',
      createdAt: fortyDaysAgo,
      resolvedAt: fortyDaysAgo,
    });

    // Create two separate holds
    const { hold: holdA } = await createRetentionHold(
      { scopeType: 'INCIDENT', scopeId: incident.id, reason: 'Hold A' },
      admin.id
    );
    const { hold: holdB } = await createRetentionHold(
      { scopeType: 'INCIDENT', scopeId: incident.id, reason: 'Hold B' },
      admin.id
    );

    const policyOverride = { incidentRetentionDays: 30 };

    // Release only hold A
    await releaseRetentionHold(holdA.id, admin.id);

    // Attempt cleanup: still protected by hold B
    const cleanupResult = await performDataCleanup(false, policyOverride);
    expect(cleanupResult.incidents).toBe(0);

    const stillProtected = await testPrisma.incident.findUnique({
      where: { id: incident.id },
    });
    expect(stillProtected).not.toBeNull();

    // Release hold B
    await releaseRetentionHold(holdB.id, admin.id);

    // Now cleanup succeeds
    const cleanupResult2 = await performDataCleanup(false, policyOverride);
    expect(cleanupResult2.incidents).toBe(1);

    const deleted = await testPrisma.incident.findUnique({
      where: { id: incident.id },
    });
    expect(deleted).toBeNull();
  });

  it('expired hold (expiresAt in past) does not block cleanup', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Expired Hold Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const incident = await createTestIncident('Expired Hold Incident', service.id, {
      status: 'RESOLVED',
      createdAt: fortyDaysAgo,
      resolvedAt: fortyDaysAgo,
    });

    // Create a hold that has already expired in the past
    // (Inserting directly via Prisma to simulate the passage of time)
    await testPrisma.dataRetentionHold.create({
      data: {
        scopeType: 'INCIDENT',
        scopeId: incident.id,
        reason: 'Expired legal hold',
        createdById: admin.id,
        expiresAt: new Date(Date.now() - 10000), // in past
      },
    });

    const policyOverride = { incidentRetentionDays: 30 };
    const cleanupResult = await performDataCleanup(false, policyOverride);

    expect(cleanupResult.incidents).toBe(1);
    const incidentExists = await testPrisma.incident.findUnique({
      where: { id: incident.id },
    });
    expect(incidentExists).toBeNull();
  });

  it('completed privacy request hold prevents lifecycle cleanup until released', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    // Create completed privacy request
    const pr = await testPrisma.privacyRequest.create({
      data: {
        subjectType: 'USER',
        subjectId: admin.id,
        requestType: 'ACCESS',
        status: 'COMPLETED',
        updatedAt: fortyDaysAgo,
      },
    });

    // Put hold on the completed privacy request
    const { hold } = await createRetentionHold(
      {
        scopeType: 'PRIVACY_REQUEST',
        scopeId: pr.id,
        reason: 'Retain request evidence for compliance',
      },
      admin.id
    );

    const policyOverride = { completedPrivacyRequestRetentionDays: 30 };

    // Cleanup: should NOT delete held request
    const cleanupResult = await performDataCleanup(false, policyOverride);
    expect(cleanupResult.lifecycle.privacyRequests).toBe(0);

    const prExists = await testPrisma.privacyRequest.findUnique({
      where: { id: pr.id },
    });
    expect(prExists).not.toBeNull();

    // Release hold
    await releaseRetentionHold(hold.id, admin.id);

    // Cleanup: now deletes request
    const postReleaseCleanup = await performDataCleanup(false, policyOverride);
    expect(postReleaseCleanup.lifecycle.privacyRequests).toBe(1);

    const prDeleted = await testPrisma.privacyRequest.findUnique({
      where: { id: pr.id },
    });
    expect(prDeleted).toBeNull();
  });
});
