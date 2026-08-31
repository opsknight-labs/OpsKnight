/**
 * Integration Tests for Complete Notification Flow (REAL SETUP)
 *
 * Replaces mocks with real database interactions.
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';

// We mock external API calls (Slack, Email provider, SMS) but NOT the database.
// IMPORTANT: Use top-level mocks + dynamic imports for modules under test so the mocks
// are applied before `src/lib/*` is evaluated (prevents flaky CI failures).
vi.mock('../../src/lib/slack', () => ({
  notifySlackForIncident: vi.fn().mockResolvedValue({ success: true }),
  sendSlackNotification: vi.fn().mockResolvedValue({ success: true }),
  sendSlackMessageToChannel: vi.fn().mockResolvedValue({ success: true }),
  getSlackBotToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/email', () => ({
  sendIncidentEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/email', () => ({
  sendIncidentEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../src/lib/sms', () => ({
  sendIncidentSMS: vi.fn().mockResolvedValue({ success: true }),
}));

import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestService,
  createTestIncident,
  createTestTeam,
  createTestNotificationProvider,
  createTestEscalationPolicy,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Notification Flow Integration Tests (Real DB)', () => {
  let sendServiceNotifications: typeof import('../../src/lib/service-notifications').sendServiceNotifications;
  let executeEscalation: typeof import('../../src/lib/escalation').executeEscalation;

  beforeAll(async () => {
    process.env.VITEST_USE_REAL_DB = '1';
    // Import after mocks are registered
    ({ sendServiceNotifications } = await import('../../src/lib/service-notifications'));
    ({ executeEscalation } = await import('../../src/lib/escalation'));

    // Ensure providers exist
    await resetDatabase();
  });

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    await resetDatabase();

    // Create a default provider to avoid "no provider" errors if code checks it
    await createTestNotificationProvider('resend', {
      apiKey: 'test',
      fromEmail: 'alerts@example.com',
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should send service notifications and escalation notifications', async () => {
    // 1. Setup Data
    const user = await createTestUser({ emailNotificationsEnabled: true });

    // Create Policy
    const policy = await createTestEscalationPolicy('Test Policy', [
      {
        stepOrder: 0,
        delayMinutes: 0,
        targetType: 'USER',
        targetUser: { connect: { id: user.id } },
        // Force EMAIL for deterministic assertion
        notificationChannels: ['EMAIL'],
      },
    ]);

    const service = await createTestService('Test Service', null, {
      serviceNotificationChannels: ['SLACK'],
      slackWebhookUrl: 'https://hooks.slack.com/test',
      escalationPolicyId: policy.id,
    });

    const incident = await createTestIncident('Test Incident', service.id);

    // 2. Send Service Notifications
    // 2. Send Service Notifications
    const serviceResult = await sendServiceNotifications(incident.id, 'triggered');
    expect(serviceResult.success).toBe(true);

    // Service integrations now create durable external-recipient intents, but
    // must not create a personal user notification before escalation.
    const beforeEscalation = await testPrisma.notification.findMany({
      where: { incidentId: incident.id },
    });
    expect(beforeEscalation).toHaveLength(1);
    expect(beforeEscalation[0]).toMatchObject({
      channel: 'SLACK',
      recipientType: 'WEBHOOK',
      userId: null,
    });

    // 3. Execute Escalation
    // This should trigger the policy step 0 -> Notify User
    const escalationResult = await executeEscalation(incident.id, 0);
    expect(escalationResult.escalated).toBe(true);

    // 4. Verify Notifications Created
    const notifications = await testPrisma.notification.findMany({
      where: { incidentId: incident.id },
    });

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].userId).toBe(user.id);
    expect(notifications.some(n => n.channel === 'EMAIL')).toBe(true);
  });

  it('should handle team escalation (Real DB)', async () => {
    // 1. Setup Team
    const lead = await createTestUser({ email: 'lead@test.com', emailNotificationsEnabled: true });
    const member = await createTestUser({
      email: 'member@test.com',
      emailNotificationsEnabled: true,
    });

    const team = await createTestTeam('Test Team', {
      teamLeadId: lead.id,
      members: {
        create: [
          { userId: lead.id, role: 'OWNER', receiveTeamNotifications: true },
          { userId: member.id, role: 'MEMBER', receiveTeamNotifications: true },
        ],
      },
    });

    // 2. Setup Policy targeting Team
    const policy = await createTestEscalationPolicy('Team Policy', [
      {
        stepOrder: 0,
        delayMinutes: 0,
        targetType: 'TEAM',
        targetTeam: { connect: { id: team.id } },
        notifyOnlyTeamLead: true,
        notificationChannels: ['EMAIL'],
      },
    ]);

    const service = await createTestService('Team Service', team.id, {
      escalationPolicyId: policy.id,
    });

    const incident = await createTestIncident('Team Incident', service.id);

    // 3. Execute Escalation
    const result = await executeEscalation(incident.id, 0);

    expect(result.escalated).toBe(true);
    expect(result.targetCount).toBe(1); // Only lead

    // 4. Verify DB
    const notifications = await testPrisma.notification.findMany({
      where: { incidentId: incident.id },
    });

    // Should only notify lead
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(lead.id);
  });
});
