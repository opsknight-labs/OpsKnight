// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma, createTestUser } from '../helpers/test-db';
import { projectControlDrift } from '@/lib/compliance/drift/projector';
import { acknowledgeComplianceDrift } from '@/lib/compliance/drift/acknowledge';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('compliance drift projector (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('handles full lifecycle: baseline creation, drift detection, deduplication, acknowledgment, and recovery', async () => {
    const controlId = 'ENC-01';

    // 1. Create first (passing) evaluation
    await testPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'IMPLEMENTED',
        trigger: 'SCHEDULED',
        evaluatorId: 'eval-enc-01',
        evaluatorVersion: '1.0.0',
        summary: 'TLS 1.3 enforced across all endpoints',
        findings: [],
        evaluatedAt: new Date('2026-09-20T10:00:00.000Z'),
      },
    });

    // Run projector on eval1 -> should initialize baseline
    const projResult1 = await projectControlDrift({ controlId, prisma: testPrisma });
    expect(projResult1.baselineEstablished).toBe(true);
    expect(projResult1.driftsOpened).toBe(0);
    expect(projResult1.driftsResolved).toBe(0);

    const baseline1 = await testPrisma.complianceDriftBaseline.findUnique({
      where: { controlId },
    });
    expect(baseline1).not.toBeNull();
    expect(baseline1?.resolvedStatus).toBe('IMPLEMENTED');

    // 2. Create second (regressed) evaluation
    await testPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'ACTION_REQUIRED',
        trigger: 'SCHEDULED',
        evaluatorId: 'eval-enc-01',
        evaluatorVersion: '1.0.0',
        summary: 'Insecure TLS 1.0 protocol detected',
        findings: [],
        evaluatedAt: new Date('2026-09-20T11:00:00.000Z'),
      },
    });

    const projResult2 = await projectControlDrift({ controlId, prisma: testPrisma });
    expect(projResult2.driftsOpened).toBeGreaterThanOrEqual(1);

    const openEvents = await testPrisma.complianceDriftEvent.findMany({
      where: { controlId, status: 'OPEN' },
    });
    expect(openEvents).toHaveLength(1);
    const driftEvent = openEvents[0];
    expect(driftEvent.kind).toBe('CONTROL_STATUS_REGRESSION');
    expect(driftEvent.activeDedupeKey).toBeTruthy();
    expect(driftEvent.occurrenceCount).toBe(1);

    // 3. Create third (still regressed) evaluation -> should NOT duplicate drift event
    await testPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'ACTION_REQUIRED',
        trigger: 'SCHEDULED',
        evaluatorId: 'eval-enc-01',
        evaluatorVersion: '1.0.0',
        summary: 'Insecure TLS 1.0 protocol detected still',
        findings: [],
        evaluatedAt: new Date('2026-09-20T12:00:00.000Z'),
      },
    });

    const projResult3 = await projectControlDrift({ controlId, prisma: testPrisma });
    expect(projResult3.driftsOpened).toBe(0); // Deduped, not created again!

    const openEventsAfterThird = await testPrisma.complianceDriftEvent.findMany({
      where: { controlId, status: 'OPEN' },
    });
    expect(openEventsAfterThird).toHaveLength(1); // Still exactly 1 open event

    // 4. Operator acknowledges the drift event
    const testUser = await createTestUser({ email: 'compliance-admin@opsknight.local' });
    const acknowledgedEvent = await acknowledgeComplianceDrift({
      driftEventId: driftEvent.id,
      userId: testUser.id,
      prisma: testPrisma,
    });
    expect(acknowledgedEvent.status).toBe('ACKNOWLEDGED');
    expect(acknowledgedEvent.acknowledgedByUserId).toBe(testUser.id);
    expect(acknowledgedEvent.acknowledgedAt).not.toBeNull();

    // 5. Technical recovery occurs (new passing evaluation)
    await testPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'IMPLEMENTED',
        trigger: 'SCHEDULED',
        evaluatorId: 'eval-enc-01',
        evaluatorVersion: '1.0.0',
        summary: 'TLS 1.3 restored and validated',
        findings: [],
        evaluatedAt: new Date('2026-09-20T13:00:00.000Z'),
      },
    });

    const projResult4 = await projectControlDrift({ controlId, prisma: testPrisma });
    expect(projResult4.driftsResolved).toBe(1);

    // Verify previously acknowledged event is now RESOLVED and activeDedupeKey is cleared
    const resolvedEvent = await testPrisma.complianceDriftEvent.findUnique({
      where: { id: driftEvent.id },
    });
    expect(resolvedEvent?.status).toBe('RESOLVED');
    expect(resolvedEvent?.resolvedAt).not.toBeNull();
    expect(resolvedEvent?.activeDedupeKey).toBeNull(); // Cleared to allow future drift

    // Verify baseline was updated to recovered state
    const updatedBaseline = await testPrisma.complianceDriftBaseline.findUnique({
      where: { controlId },
    });
    expect(updatedBaseline?.resolvedStatus).toBe('IMPLEMENTED');
  });
});
