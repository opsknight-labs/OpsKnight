import { describe, it, expect, beforeEach } from 'vitest';
import { executeEscalation } from '@/lib/escalation';
import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestService,
  createTestIncident,
  createTestEscalationPolicy,
  createTestOnCallSchedule,
  createTestScheduleOverride,
  createTestNotificationProvider,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Database Resilience Integration Tests', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
    // Ensure default provider exists for user notifications IN EACH TEST
    // because resetDatabase() clears it.
    await createTestNotificationProvider('resend', {
      apiKey: 'test-api-key',
      fromEmail: 'alerts@opsknight.com',
    });
  });

  describe('On-Call Schedule Resilience', () => {
    it('should add a standalone override user during the override window', async () => {
      const primaryUser = await createTestUser({
        name: 'Primary User',
        email: 'primary@example.com',
        emailNotificationsEnabled: true,
      });
      const overrideUser = await createTestUser({
        name: 'Override User',
        email: 'override@example.com',
        emailNotificationsEnabled: true,
      });

      // Create a schedule where primaryUser is always on-call
      const schedule = await createTestOnCallSchedule('Test Schedule', [
        {
          name: 'Primary Layer',
          rotationLengthHours: 1000,
          userIds: [primaryUser.id],
          start: new Date(Date.now() - 3600000), // Started 1 hour ago
        },
      ]);

      // Add an override for overrideUser starting NOW for 1 hour
      const now = new Date();
      const end = new Date(now.getTime() + 3600000);
      await createTestScheduleOverride(schedule.id, overrideUser.id, now, end);

      // Create policy targeting this schedule
      const policy = await createTestEscalationPolicy('On-Call Policy', [
        {
          stepOrder: 0,
          delayMinutes: 0,
          targetType: 'SCHEDULE',
          targetScheduleId: schedule.id,
        },
      ]);

      const service = await createTestService('Critical Service', null, {
        escalationPolicyId: policy.id,
      });
      const incident = await createTestIncident('Production Outage', service.id);

      // Execute escalation
      const result = await executeEscalation(incident.id, 0);

      expect(result.escalated).toBe(true);
      expect(result.targetCount).toBe(2);

      // Wait for DB to settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      // A standalone override is additive, so both responders are notified.
      const notifications = await testPrisma.notification.findMany({
        where: { incidentId: incident.id },
      });
      expect(notifications).toHaveLength(2);
      expect(new Set(notifications.map(notification => notification.userId))).toEqual(
        new Set([primaryUser.id, overrideUser.id])
      );

      // Assignment is distributed deterministically across the active responders.
      const updatedIncident = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect([primaryUser.id, overrideUser.id]).toContain(updatedIncident?.assigneeId);
    });
  });

  describe('Multi-Step Escalation Chain', () => {
    it('should advance through multiple steps correctly', async () => {
      const user1 = await createTestUser({
        name: 'Level 1',
        email: 'l1@example.com',
        emailNotificationsEnabled: true,
      });
      const user2 = await createTestUser({
        name: 'Level 2',
        email: 'l2@example.com',
        emailNotificationsEnabled: true,
      });

      const policy = await createTestEscalationPolicy('Tiered Policy', [
        {
          stepOrder: 0,
          delayMinutes: 0,
          targetType: 'USER',
          targetUserId: user1.id,
        },
        {
          stepOrder: 1,
          delayMinutes: 5,
          targetType: 'USER',
          targetUserId: user2.id,
        },
      ]);

      const service = await createTestService('Tiered Service', null, {
        escalationPolicyId: policy.id,
      });
      const incident = await createTestIncident('Tiered Incident', service.id);

      // 1. Run Step 0
      const res1 = await executeEscalation(incident.id, 0);
      expect(res1.stepIndex).toBe(0);
      expect(res1.nextStepScheduled).toBe(true);

      const incAfterStep0 = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect(incAfterStep0?.currentEscalationStep).toBe(1);
      expect(incAfterStep0?.escalationStatus).toBe('ESCALATING');
      expect(incAfterStep0?.nextEscalationAt).not.toBeNull();

      await testPrisma.incident.update({
        where: { id: incident.id },
        data: { nextEscalationAt: new Date(Date.now() - 1000) },
      });

      // 2. Run Step 1 (Manually trigger it to simulate job execution)
      const res2 = await executeEscalation(incident.id, 1);
      expect(res2.stepIndex).toBe(1);
      expect(res2.nextStepScheduled).toBe(false);

      // Wait for DB to settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      const incAfterStep1 = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect(incAfterStep1?.escalationStatus).toBe('COMPLETED');
      expect(incAfterStep1?.nextEscalationAt).toBeNull();

      // 3. Verify both users got notified
      const allNotifications = await testPrisma.notification.findMany({
        where: { incidentId: incident.id },
      });
      expect(allNotifications).toHaveLength(2);
      expect(new Set(allNotifications.map(n => n.userId))).toEqual(new Set([user1.id, user2.id]));
    });
  });

  describe('Concurrency and Locking', () => {
    it('should prevent duplicate escalations via lock', async () => {
      const user = await createTestUser({ emailNotificationsEnabled: true });
      const policy = await createTestEscalationPolicy('Lock Policy', [
        {
          stepOrder: 0,
          delayMinutes: 0,
          targetType: 'USER',
          targetUserId: user.id,
        },
      ]);

      const service = await createTestService('Lock Service', null, {
        escalationPolicyId: policy.id,
      });
      const incident = await createTestIncident('Lock Incident', service.id);

      // Simulate two simultaneous calls
      const [res1, res2] = await Promise.all([
        executeEscalation(incident.id, 0),
        executeEscalation(incident.id, 0),
      ]);

      // Exactly one worker owns the step. The loser's outcome depends on whether
      // the winner had already committed when the loser re-read: a live
      // escalation reads as ALREADY_CLAIMED, a finished one as SUPERSEDED.
      // Both are authoritative and settle the job; what matters is that the
      // loser neither escalated nor paged anyone.
      const escalated = [res1, res2].filter(r => r.escalated);
      const rejected = [res1, res2].filter(r => !r.escalated);

      expect(escalated).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(['ALREADY_CLAIMED', 'SUPERSEDED']).toContain(rejected[0].outcome);

      // Wait for DB to settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify only ONE notification record exists
      const notifications = await testPrisma.notification.findMany({
        where: { incidentId: incident.id },
      });
      expect(notifications).toHaveLength(1);
    });
  });

  describe('Graceful Recovery', () => {
    it('should skip to next step if target is invalid', async () => {
      const user = await createTestUser({
        email: 'valid@example.com',
        emailNotificationsEnabled: true,
      });

      const emptyTeam = await testPrisma.team.create({ data: { name: 'Empty Team' } });

      // Step 0 targets a team with no members
      // Step 1 targets a valid user
      const policy = await createTestEscalationPolicy('Recovery Policy', [
        {
          stepOrder: 0,
          delayMinutes: 0,
          targetType: 'TEAM',
          targetTeamId: emptyTeam.id,
        },
        {
          stepOrder: 1,
          delayMinutes: 0,
          targetType: 'USER',
          targetUserId: user.id,
        },
      ]);

      const service = await createTestService('Recovery Service', null, {
        escalationPolicyId: policy.id,
      });
      const incident = await createTestIncident('Recovery Incident', service.id);

      // Execute - it should advance state and queue step 1 without recursive execution.
      const result = await executeEscalation(incident.id, 0);

      expect(result).toEqual({
        outcome: 'STEP_SCHEDULED',
        escalated: false,
        reason: 'Escalation scheduled',
        stepIndex: 0,
        nextStepScheduled: true,
      });

      const updatedIncident = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect(updatedIncident?.currentEscalationStep).toBe(1);
      expect(updatedIncident?.escalationStatus).toBe('ESCALATING');
      // The skipped tier stays discoverable by state alone, so a lost job row
      // is recoverable by the reconciliation scanner.
      expect(updatedIncident?.nextEscalationAt).not.toBeNull();
      expect(updatedIncident?.escalationProcessingAt).toBeNull();

      const queuedStep = await testPrisma.backgroundJob.findFirst({
        where: { type: 'ESCALATION', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      // The job names the generation it belongs to, so a worker can verify it
      // before paging anyone.
      expect(queuedStep?.payload).toMatchObject({
        incidentId: incident.id,
        stepIndex: 1,
        generation: updatedIncident?.escalationGeneration ?? 0,
      });

      // Wait for DB to settle
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify audit log exists for the failure
      const events = await testPrisma.incidentEvent.findMany({
        where: { incidentId: incident.id },
      });
      expect(events.some(e => e.message.includes('resolved to no users'))).toBe(true);
    });
  });
});
