import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { executeErasure } from '@/lib/privacy/erasure/execute';
import { createRetentionHold, releaseRetentionHold } from '@/lib/retention/holds';
import {
  performDataCleanup,
  acquireCleanupMutexLease,
  renewCleanupMutexLease,
  releaseCleanupMutexLease,
  CLEANUP_MUTEX_KEY,
} from '@/lib/data-cleanup';
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

  it('concurrent incident hold creation vs cleanup race: resource is NEVER deleted if hold succeeds', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Race Test Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const incident = await createTestIncident('Race Incident', service.id, {
      status: 'RESOLVED',
      createdAt: fortyDaysAgo,
      resolvedAt: fortyDaysAgo,
    });

    const policyOverride = { incidentRetentionDays: 30 };

    // Launch cleanup and hold creation concurrently
    const [cleanupResult, holdResult] = await Promise.allSettled([
      performDataCleanup(false, policyOverride),
      createRetentionHold(
        {
          scopeType: 'INCIDENT',
          scopeId: incident.id,
          reason: 'Legal litigation hold during concurrent cleanup',
        },
        admin.id
      ),
    ]);

    const incidentInDb = await testPrisma.incident.findUnique({
      where: { id: incident.id },
    });

    // Invariant: NEVER can hold creation succeed AND the incident be deleted
    if (holdResult.status === 'fulfilled') {
      expect(incidentInDb).not.toBeNull();
      expect(holdResult.value.hold.status).toBe('ACTIVE');
    } else {
      // If hold creation failed, cleanup won the race and deleted it before hold creation
      expect(incidentInDb).toBeNull();
      expect(cleanupResult.status).toBe('fulfilled');
    }
  });

  it('concurrent privacy request hold creation vs cleanup race: resource is NEVER deleted if hold succeeds', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const pr = await testPrisma.privacyRequest.create({
      data: {
        subjectType: 'USER',
        subjectId: admin.id,
        requestType: 'ACCESS',
        status: 'COMPLETED',
        updatedAt: fortyDaysAgo,
      },
    });

    const policyOverride = { completedPrivacyRequestRetentionDays: 30 };

    // Launch cleanup and hold creation concurrently
    const [cleanupResult, holdResult] = await Promise.allSettled([
      performDataCleanup(false, policyOverride),
      createRetentionHold(
        {
          scopeType: 'PRIVACY_REQUEST',
          scopeId: pr.id,
          reason: 'Regulatory hold during concurrent cleanup',
        },
        admin.id
      ),
    ]);

    const prInDb = await testPrisma.privacyRequest.findUnique({
      where: { id: pr.id },
    });

    // Invariant: NEVER can hold creation succeed AND the privacy request be deleted
    if (holdResult.status === 'fulfilled') {
      expect(prInDb).not.toBeNull();
      expect(holdResult.value.hold.status).toBe('ACTIVE');
    } else {
      expect(prInDb).toBeNull();
      expect(cleanupResult.status).toBe('fulfilled');
    }
  });

  it('incident hold preserves linked alerts while unlinked old alerts are pruned', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Alert Preservation Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const incident = await createTestIncident('Held Incident With Alerts', service.id, {
      status: 'RESOLVED',
      createdAt: fortyDaysAgo,
      resolvedAt: fortyDaysAgo,
    });

    // 1. Create alert linked to the held incident (older than alert retention)
    const linkedAlert = await testPrisma.alert.create({
      data: {
        payload: { summary: 'Linked alert for held incident' },
        serviceId: service.id,
        incidentId: incident.id,
        createdAt: fortyDaysAgo,
        status: 'RESOLVED',
      },
    });

    // 2. Create unlinked standalone alert (older than alert retention)
    const unlinkedAlert = await testPrisma.alert.create({
      data: {
        payload: { summary: 'Unlinked old alert' },
        serviceId: service.id,
        incidentId: null,
        createdAt: fortyDaysAgo,
        status: 'RESOLVED',
      },
    });

    // Place hold on incident
    await createRetentionHold(
      {
        scopeType: 'INCIDENT',
        scopeId: incident.id,
        reason: 'Hold preserving incident aggregate and linked alerts',
      },
      admin.id
    );

    const policyOverride = { incidentRetentionDays: 30, alertRetentionDays: 30 };
    await performDataCleanup(false, policyOverride);

    // Linked alert must survive because its parent incident is held
    const linkedSurvives = await testPrisma.alert.findUnique({
      where: { id: linkedAlert.id },
    });
    expect(linkedSurvives).not.toBeNull();

    // Unlinked alert must be deleted
    const unlinkedDeleted = await testPrisma.alert.findUnique({
      where: { id: unlinkedAlert.id },
    });
    expect(unlinkedDeleted).toBeNull();
  });

  it('privacy request hold preserves expired export artifacts from deletion', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const pr = await testPrisma.privacyRequest.create({
      data: {
        subjectType: 'USER',
        subjectId: admin.id,
        requestType: 'ACCESS',
        status: 'COMPLETED',
        updatedAt: fortyDaysAgo,
      },
    });

    const artifact = await testPrisma.privacyExportArtifact.create({
      data: {
        requestId: pr.id,
        status: 'EXPIRED',
        expiresAt: fortyDaysAgo,
      },
    });

    // Put hold on the privacy request
    await createRetentionHold(
      {
        scopeType: 'PRIVACY_REQUEST',
        scopeId: pr.id,
        reason: 'Hold preserving request and artifact evidence',
      },
      admin.id
    );

    const policyOverride = {
      completedPrivacyRequestRetentionDays: 30,
      expiredPrivacyArtifactRetentionDays: 30,
    };
    await performDataCleanup(false, policyOverride);

    // Both request and artifact must be preserved
    const prSurvives = await testPrisma.privacyRequest.findUnique({
      where: { id: pr.id },
    });
    expect(prSurvives).not.toBeNull();

    const artifactSurvives = await testPrisma.privacyExportArtifact.findUnique({
      where: { id: artifact.id },
    });
    expect(artifactSurvives).not.toBeNull();
  });

  it('concurrent release calls are strictly idempotent and emit exactly one audit event', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Concurrent Release Service');

    const incident = await createTestIncident('Concurrent Release Incident', service.id);
    const { hold } = await createRetentionHold(
      {
        scopeType: 'INCIDENT',
        scopeId: incident.id,
        reason: 'Hold for concurrency test',
      },
      admin.id
    );

    // Concurrently release the same hold twice
    const [resA, resB] = await Promise.all([
      releaseRetentionHold(hold.id, admin.id),
      releaseRetentionHold(hold.id, admin.id),
    ]);

    // Exactly one must be the initial release (wasAlreadyReleased: false)
    // and the other must be the idempotent no-op (wasAlreadyReleased: true)
    const releasedFlags = [resA.wasAlreadyReleased, resB.wasAlreadyReleased];
    expect(releasedFlags).toContain(false);
    expect(releasedFlags).toContain(true);

    // Exactly one release audit event should be logged in AuditLog
    const releaseAudits = await testPrisma.auditLog.findMany({
      where: {
        entityType: 'DATA_RETENTION_HOLD',
        entityId: hold.id,
        action: 'retention.hold.released',
      },
    });
    expect(releaseAudits.length).toBe(1);
  });

  it('concurrent incident hold creation vs cleanup of linked alert/event: if hold succeeds, child evidence survives', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Child Evidence Race Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    // Incident is recent enough or open so it is NOT eligible for incident deletion itself,
    // but its linked alert and event are older than retention cutoffs and eligible for standalone cleanup.
    const incident = await createTestIncident('Parent Incident With Old Children', service.id, {
      status: 'OPEN',
      createdAt: fortyDaysAgo,
    });

    const alert = await testPrisma.alert.create({
      data: {
        payload: { summary: 'Old alert linked to open incident' },
        serviceId: service.id,
        incidentId: incident.id,
        createdAt: fortyDaysAgo,
        status: 'RESOLVED',
      },
    });

    const event = await testPrisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        message: 'Old incident event',
        createdAt: fortyDaysAgo,
      },
    });

    const policyOverride = {
      incidentRetentionDays: 90, // Incident itself will not be deleted
      alertRetentionDays: 30, // Alert is eligible for standalone cleanup
      logRetentionDays: 30, // Event is eligible for standalone cleanup
    };

    // Run standalone cleanup and hold creation concurrently
    const [cleanupResult, holdResult] = await Promise.allSettled([
      performDataCleanup(false, policyOverride),
      createRetentionHold(
        {
          scopeType: 'INCIDENT',
          scopeId: incident.id,
          reason: 'Hold protecting incident and all child evidence',
        },
        admin.id
      ),
    ]);

    const alertInDb = await testPrisma.alert.findUnique({
      where: { id: alert.id },
    });
    const eventInDb = await testPrisma.incidentEvent.findUnique({
      where: { id: event.id },
    });

    // Invariant: If hold creation succeeded, child evidence MUST survive
    if (holdResult.status === 'fulfilled') {
      expect(alertInDb).not.toBeNull();
      expect(eventInDb).not.toBeNull();
      expect(holdResult.value.hold.status).toBe('ACTIVE');
    } else {
      expect(cleanupResult.status).toBe('fulfilled');
    }
  });

  it('concurrent privacy request hold creation vs artifact cleanup race: if hold succeeds, artifact survives', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    // Create privacy request (with completed request retention long enough so parent is not pruned)
    const pr = await testPrisma.privacyRequest.create({
      data: {
        subjectType: 'USER',
        subjectId: admin.id,
        requestType: 'ACCESS',
        status: 'COMPLETED',
        updatedAt: fortyDaysAgo,
      },
    });

    // Create expired export artifact older than artifact retention cutoff
    const artifact = await testPrisma.privacyExportArtifact.create({
      data: {
        requestId: pr.id,
        status: 'EXPIRED',
        createdAt: fortyDaysAgo,
        expiresAt: fortyDaysAgo,
      },
    });

    const policyOverride = {
      completedPrivacyRequestRetentionDays: 90, // Parent request will not be pruned
      expiredPrivacyArtifactRetentionDays: 30, // Artifact is eligible for expired artifact cleanup
    };

    // Run cleanup and hold creation concurrently
    const [cleanupResult, holdResult] = await Promise.allSettled([
      performDataCleanup(false, policyOverride),
      createRetentionHold(
        {
          scopeType: 'PRIVACY_REQUEST',
          scopeId: pr.id,
          reason: 'Regulatory hold preserving artifact evidence',
        },
        admin.id
      ),
    ]);

    const artifactInDb = await testPrisma.privacyExportArtifact.findUnique({
      where: { id: artifact.id },
    });

    // Invariant: If hold creation succeeded, the export artifact MUST survive
    if (holdResult.status === 'fulfilled') {
      expect(artifactInDb).not.toBeNull();
      expect(holdResult.value.hold.status).toBe('ACTIVE');
    } else {
      expect(artifactInDb).toBeNull();
      expect(cleanupResult.status).toBe('fulfilled');
    }
  });

  it('fully-held first batch of >500 incidents continues and processes subsequent batches', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const service = await createTestService('Multi-Batch Service');

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    // Create 502 resolved old incidents:
    // Batch 1 (500 incidents) will be placed under retention hold
    // Batch 2 (2 incidents) will have no holds and should be deleted
    const totalIncidents = 502;
    const incidentData = Array.from({ length: totalIncidents }, (_, i) => ({
      title: `Batch Test Incident ${i}`,
      status: 'RESOLVED' as const,
      urgency: 'LOW' as const,
      serviceId: service.id,
      createdAt: fortyDaysAgo,
      resolvedAt: fortyDaysAgo,
    }));

    await testPrisma.incident.createMany({ data: incidentData });

    // Fetch created incidents ordered deterministically by id
    const createdIncidents = await testPrisma.incident.findMany({
      where: { serviceId: service.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(createdIncidents.length).toBe(totalIncidents);

    // Hold the first 500 incidents (entire first batch)
    const firstBatchIds = createdIncidents.slice(0, 500).map(inc => inc.id);
    const holdData = firstBatchIds.map(id => ({
      scopeType: 'INCIDENT' as const,
      scopeId: id,
      reason: 'Batch 1 retention hold',
      createdById: admin.id,
    }));

    await testPrisma.dataRetentionHold.createMany({ data: holdData });

    const policyOverride = { incidentRetentionDays: 30 };
    const cleanupResult = await performDataCleanup(false, policyOverride);

    // Batch 2 (remaining 2 incidents) must be successfully deleted
    expect(cleanupResult.incidents).toBe(2);
    expect(cleanupResult.held.incidents).toBeGreaterThanOrEqual(500);

    // Verify first batch survived in DB
    const remainingIncidents = await testPrisma.incident.findMany({
      where: { serviceId: service.id },
      select: { id: true },
    });
    expect(remainingIncidents.length).toBe(500);
    const remainingIds = new Set(remainingIncidents.map(inc => inc.id));
    for (const heldId of firstBatchIds) {
      expect(remainingIds.has(heldId)).toBe(true);
    }
  });

  it('cleanup mutex lease enforces fencing tokens and supports renewal', async () => {
    // 1. Acquire initial lease
    const token1 = await acquireCleanupMutexLease();
    expect(token1).not.toBeNull();
    expect(typeof token1).toBe('number');

    // 2. Another concurrent acquisition while lease is active should fail (return null)
    const token2 = await acquireCleanupMutexLease();
    expect(token2).toBeNull();

    // 3. Renew the active lease with the matching fencing token
    const renewed = await renewCleanupMutexLease(token1!);
    expect(renewed).toBe(true);

    // 4. Simulating lease expiry and takeover by another worker:
    // Update expiresAt to past and let worker 2 acquire it (incrementing count)
    await testPrisma.$executeRaw`
      UPDATE "RateLimit"
      SET "expiresAt" = NOW() - INTERVAL '1 second'
      WHERE "key" = ${CLEANUP_MUTEX_KEY}
    `;

    const token3 = await acquireCleanupMutexLease();
    expect(token3).not.toBeNull();
    expect(token3).toBeGreaterThan(token1!);

    // 5. Worker 1 tries to release using its stale token1:
    // It must NOT delete worker 2's lease!
    const staleRelease = await releaseCleanupMutexLease(token1!);
    expect(staleRelease).toBe(false);

    // Verify worker 2's lease row is still present in DB
    const activeLease = await testPrisma.rateLimit.findUnique({
      where: { key: CLEANUP_MUTEX_KEY },
    });
    expect(activeLease).not.toBeNull();
    expect(activeLease!.count).toBe(token3);

    // 6. Worker 2 releases with its valid token3:
    const validRelease = await releaseCleanupMutexLease(token3!);
    expect(validRelease).toBe(true);

    const deletedLease = await testPrisma.rateLimit.findUnique({
      where: { key: CLEANUP_MUTEX_KEY },
    });
    expect(deletedLease).toBeNull();
  });
});
