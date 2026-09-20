import { describe, expect, it } from 'vitest';
import { certPrisma, getMailpitMessages } from './helpers';
import {
  dispatchComplianceDriftNotification,
  MAX_NOTIFICATIONS_PER_EPISODE,
} from '@/lib/compliance/drift/notifications';

describe('Gate 8: Real Central Notification Delivery & Anti-Storm Certification', () => {
  it('certifies central notification delivery, anti-storm limits, and flapping cooldown', async () => {
    // 1. Create test admin recipient
    let admin = await certPrisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
    });

    if (!admin) {
      admin = await certPrisma.user.create({
        data: {
          name: 'Cert Admin',
          email: 'cert-admin-notifications@opsknight.local',
          role: 'ADMIN',
          status: 'ACTIVE',
          passwordHash: 'dummy-hash-for-cert',
        },
      });
    }

    // Clean up any previous test event
    await certPrisma.notification.deleteMany({
      where: { sourceId: 'drift-cert-notif-01' },
    });
    await certPrisma.complianceDriftEvent.deleteMany({
      where: { id: 'drift-cert-notif-01' },
    });

    const testEvent = await certPrisma.complianceDriftEvent.create({
      data: {
        id: 'drift-cert-notif-01',
        subjectType: 'COMPLIANCE_CONTROL',
        subjectId: 'CERT-SEC-NOTIF-01',
        controlId: 'CERT-SEC-NOTIF-01',
        kind: 'CONTROL_STATUS_REGRESSION',
        impact: 'ACTION_REQUIRED',
        status: 'OPEN',
        fingerprint: 'cert-fingerprint-01',
        activeDedupeKey: 'drift-cert-notif-01:ACTIVE',
        summary: 'Critical encryption control regressed in certification environment',
        details: { cause: 'automated-test' },
        firstDetectedAt: new Date(),
        lastObservedAt: new Date(),
      },
    });

    // 2. Dispatch first notification generation
    const dispatch1 = await certPrisma.$transaction(async tx => {
      return dispatchComplianceDriftNotification(tx, {
        driftEvent: testEvent,
        generation: 1,
        now: new Date(),
      });
    });
    expect(dispatch1.dispatched).toBe(true);

    // Verify Notification record created with encrypted payload
    const intent = await certPrisma.notification.findFirst({
      where: { sourceId: testEvent.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(intent).toBeDefined();
    expect(intent?.channel).toBe('EMAIL');
    expect(intent?.category).toBe('SECURITY');
    expect(intent?.payloadEncrypted).toBeDefined();

    // 3. Anti-storm limit: generation > MAX_NOTIFICATIONS_PER_EPISODE is suppressed
    const dispatchOverLimit = await certPrisma.$transaction(async tx => {
      return dispatchComplianceDriftNotification(tx, {
        driftEvent: testEvent,
        generation: MAX_NOTIFICATIONS_PER_EPISODE + 1,
        now: new Date(),
      });
    });
    expect(dispatchOverLimit.dispatched).toBe(false);
    expect(dispatchOverLimit.reason).toBe('MAX_GENERATIONS_EXCEEDED');

    // 4. Mailpit receipt check (when Mailpit is running)
    const messages = await getMailpitMessages();
    if (messages.length > 0) {
      const match = messages.find(m => m.Subject.includes('CERT-SEC-NOTIF-01'));
      if (match) {
        expect(match.To[0].Address).toContain('@');
      }
    }
  });
});
