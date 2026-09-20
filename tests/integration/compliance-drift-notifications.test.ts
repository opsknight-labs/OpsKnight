// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma, createTestUser } from '../helpers/test-db';
import { dispatchComplianceDriftNotification } from '@/lib/compliance/drift/notifications';
import { decrypt } from '@/lib/encryption';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('compliance drift notifications anti-storm & cooldown (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('dispatches valid central EMAIL intent for actionable drift and suppresses subsequent flapping within cooldown', async () => {
    // 1. Create an admin user to receive compliance drift notifications
    const admin = await createTestUser({
      email: 'admin@opsknight.local',
      role: 'ADMIN',
    });

    const controlId = 'ENC-01';
    const now = new Date('2026-09-20T12:00:00.000Z');

    // 2. Create an actionable drift event
    const driftEvent = await testPrisma.complianceDriftEvent.create({
      data: {
        controlId,
        subjectType: 'RUNTIME_CONTROL',
        subjectId: controlId,
        kind: 'CONTROL_STATUS_REGRESSION',
        impact: 'ACTION_REQUIRED',
        status: 'OPEN',
        fingerprint: 'fp-1',
        summary: 'TLS 1.0 enabled on ingress',
        details: {},
        firstDetectedAt: now,
        lastObservedAt: now,
        notificationGeneration: 1,
      },
    });

    // 3. Dispatch notification for generation 1
    const result1 = await testPrisma.$transaction(async tx => {
      return await dispatchComplianceDriftNotification(tx, {
        driftEvent,
        generation: 1,
        now,
      });
    });

    expect(result1.dispatched).toBe(true);

    // Verify notification row was created in central Notification table
    const notifications = await testPrisma.notification.findMany({
      where: { sourceId: driftEvent.id },
    });
    expect(notifications.length).toBeGreaterThanOrEqual(1);

    const emailNotification = notifications[0];
    expect(emailNotification.channel).toBe('EMAIL');
    expect(emailNotification.category).toBe('SECURITY');
    expect(emailNotification.userId).toBe(admin.id);
    expect(emailNotification.payloadEncrypted).toBeTruthy();

    // Verify central notification payload contract: decrypt and validate payload structure
    const decryptedPayload = JSON.parse(await decrypt(emailNotification.payloadEncrypted!));
    expect(decryptedPayload).toMatchObject({
      kind: 'EMAIL',
      to: admin.email,
      subject: expect.stringContaining('[OpsKnight Compliance Drift] Control ENC-01'),
      text: expect.stringContaining('TLS 1.0 enabled on ingress'),
      html: expect.stringContaining('TLS 1.0 enabled on ingress'),
    });

    // 4. Test anti-storm limit: generation > 5 is suppressed
    const resultMaxGen = await testPrisma.$transaction(async tx => {
      return await dispatchComplianceDriftNotification(tx, {
        driftEvent,
        generation: 6,
        now,
      });
    });
    expect(resultMaxGen.dispatched).toBe(false);
    expect(resultMaxGen.reason).toBe('MAX_GENERATIONS_EXCEEDED');

    // 5. Test flapping cooldown: simulate a previous event resolved 5 minutes ago (cooldown is 60 mins default)
    await testPrisma.complianceDriftEvent.create({
      data: {
        controlId,
        subjectType: 'RUNTIME_CONTROL',
        subjectId: controlId,
        kind: 'CONTROL_STATUS_REGRESSION',
        impact: 'ACTION_REQUIRED',
        status: 'RESOLVED',
        fingerprint: 'fp-old',
        summary: 'Older TLS drift resolved recently',
        details: {},
        firstDetectedAt: new Date(now.getTime() - 20 * 60 * 1000),
        lastObservedAt: new Date(now.getTime() - 5 * 60 * 1000),
        resolvedAt: new Date(now.getTime() - 5 * 60 * 1000),
        notificationGeneration: 1,
      },
    });

    // Create a new flapped drift event
    const flappedEvent = await testPrisma.complianceDriftEvent.create({
      data: {
        controlId,
        subjectType: 'RUNTIME_CONTROL',
        subjectId: controlId,
        kind: 'CONTROL_STATUS_REGRESSION',
        impact: 'ACTION_REQUIRED',
        status: 'OPEN',
        fingerprint: 'fp-flapped',
        summary: 'TLS 1.0 flapped back',
        details: {},
        firstDetectedAt: now,
        lastObservedAt: now,
        notificationGeneration: 1,
      },
    });

    const result2 = await testPrisma.$transaction(async tx => {
      return await dispatchComplianceDriftNotification(tx, {
        driftEvent: flappedEvent,
        generation: 1,
        now,
      });
    });

    expect(result2.dispatched).toBe(false);
    expect(result2.reason).toBe('FLAPPING_COOLDOWN');
  });
});
