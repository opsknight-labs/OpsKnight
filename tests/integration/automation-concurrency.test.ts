import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import {
  captureResponderSnapshot,
  MAX_ESCALATION_STEPS,
  MAX_RESPONDER_SNAPSHOT_BYTES,
  responderSnapshotSchema,
} from '@/lib/escalation/automation-snapshot';

describe('automation concurrency: policy modification racing with captureResponderSnapshot', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('maintains strict snapshot integrity and isolation when policy steps mutate concurrently', async () => {
    const user = await db.user.create({
      data: {
        email: `concurrency-${Date.now()}@example.com`,
        name: 'Concurrency User',
        passwordHash: 'hash',
        role: 'RESPONDER',
      },
    });

    const policy = await db.escalationPolicy.create({
      data: {
        name: 'Racing Policy',
        steps: {
          create: [
            {
              stepOrder: 0,
              delayMinutes: 5,
              targetType: 'USER',
              targetUserId: user.id,
              notificationChannels: ['EMAIL'],
              notifyOnlyTeamLead: false,
              conditions: {
                create: [
                  {
                    field: 'PRIORITY',
                    operator: 'EQUALS',
                    values: ['P1'],
                  },
                ],
              },
            },
          ],
        },
      },
      include: { steps: true },
    });

    // Run 50 concurrent rounds where one transaction mutates policy steps
    // while parallel transactions capture the responder snapshot.
    for (let round = 0; round < 50; round++) {
      const mutatePromise = db.$transaction(async tx => {
        // Clear and rebuild steps
        await tx.escalationRuleCondition.deleteMany({
          where: { rule: { policyId: policy.id } },
        });
        await tx.escalationRule.deleteMany({
          where: { policyId: policy.id },
        });

        const stepCount = (round % 5) + 1; // 1 to 5 steps
        for (let s = 0; s < stepCount; s++) {
          const rule = await tx.escalationRule.create({
            data: {
              policyId: policy.id,
              stepOrder: s,
              delayMinutes: (s + 1) * 5,
              targetType: 'USER',
              targetUserId: user.id,
              notificationChannels: ['EMAIL'],
              notifyOnlyTeamLead: false,
            },
          });
          await tx.escalationRuleCondition.create({
            data: {
              ruleId: rule.id,
              field: 'URGENCY',
              operator: 'EQUALS',
              values: ['HIGH'],
            },
          });
        }
      });

      const capturePromises = Array.from({ length: 4 }, () =>
        db.$transaction(async tx => {
          return captureResponderSnapshot(tx, policy.id);
        })
      );

      const [mutationResult, ...captureResults] = await Promise.allSettled([
        mutatePromise,
        ...capturePromises,
      ]);

      expect(mutationResult.status).toBe('fulfilled');

      for (const res of captureResults) {
        expect(res.status).toBe('fulfilled');
        if (res.status === 'fulfilled') {
          const snapshot = res.value;
          // Validate that the snapshot parsed by responderSnapshotSchema is valid and internally consistent
          expect(responderSnapshotSchema.safeParse(snapshot).success).toBe(true);
          expect(snapshot.id).toBe(policy.id);
          expect(snapshot.steps.length).toBeGreaterThanOrEqual(1);
          expect(snapshot.steps.length).toBeLessThanOrEqual(MAX_ESCALATION_STEPS);
          const serialized = JSON.stringify(snapshot);
          expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(
            MAX_RESPONDER_SNAPSHOT_BYTES
          );
          // Verify each step has valid conditions
          for (const step of snapshot.steps) {
            expect(step.conditions.length).toBeGreaterThanOrEqual(1);
            expect(['PRIORITY', 'URGENCY', 'SUPPORT_HOURS_STATE']).toContain(
              step.conditions[0].field
            );
          }
        }
      }
    }
  });

  it('fails closed if concurrent policy mutation introduces steps beyond MAX_ESCALATION_STEPS', async () => {
    const user = await db.user.create({
      data: {
        email: `oversized-${Date.now()}@example.com`,
        name: 'Oversized User',
        passwordHash: 'hash',
        role: 'RESPONDER',
      },
    });

    const policy = await db.escalationPolicy.create({
      data: {
        name: 'Oversized Race Policy',
      },
    });

    // Directly seed 51 steps
    for (let i = 0; i < 51; i++) {
      await db.escalationRule.create({
        data: {
          policyId: policy.id,
          stepOrder: i,
          delayMinutes: 5,
          targetType: 'USER',
          targetUserId: user.id,
          notificationChannels: ['EMAIL'],
          notifyOnlyTeamLead: false,
        },
      });
    }

    await expect(
      db.$transaction(tx => captureResponderSnapshot(tx, policy.id))
    ).rejects.toThrow(`Pinned escalation policy exceeds maximum step limit of ${MAX_ESCALATION_STEPS}`);
  });
});
