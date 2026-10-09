import { z } from 'zod';
import { EscalationTargetType, NotificationChannel, type Prisma } from '@prisma/client';
import { escalationConditionSchema } from './policy-validation';

export const MAX_ESCALATION_STEPS = 50;
export const MAX_RESPONDER_SNAPSHOT_BYTES = 65_536;

// Freeze policy behavior, while schedule occupants, team membership and recipient
// availability continue to resolve at execution time through the target resolver.
export const responderSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z
    .array(
      z.object({
        id: z.string(),
        policyId: z.string(),
        delayMinutes: z.number().int(),
        stepOrder: z.number().int(),
        targetType: z.nativeEnum(EscalationTargetType),
        targetUserId: z.string().nullable(),
        targetTeamId: z.string().nullable(),
        targetScheduleId: z.string().nullable(),
        notificationChannels: z.array(z.nativeEnum(NotificationChannel)),
        notifyOnlyTeamLead: z.boolean(),
        conditions: z.array(escalationConditionSchema),
      })
    )
    .max(MAX_ESCALATION_STEPS),
});

export async function captureResponderSnapshot(client: Prisma.TransactionClient, policyId: string) {
  const policy = await client.escalationPolicy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      name: true,
      steps: {
        include: { conditions: { select: { field: true, operator: true, values: true } } },
        orderBy: { stepOrder: 'asc' },
      },
    },
  });
  if (!policy) throw new Error('Pinned escalation policy is missing');
  if (policy.steps.length > MAX_ESCALATION_STEPS) {
    throw new Error(
      `Pinned escalation policy exceeds maximum step limit of ${MAX_ESCALATION_STEPS}`
    );
  }
  const parsed = responderSnapshotSchema.parse(policy);
  const serialized = JSON.stringify(parsed);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONDER_SNAPSHOT_BYTES) {
    throw new Error(
      `Pinned escalation policy snapshot exceeds byte size limit of ${MAX_RESPONDER_SNAPSHOT_BYTES} bytes`
    );
  }
  return parsed;
}

/** Serialize policy mutations before checking the resulting complete definition. */
export async function lockResponderPolicy(client: Prisma.TransactionClient, policyId: string) {
  await client.$queryRaw`SELECT id FROM "EscalationPolicy" WHERE id=${policyId} FOR UPDATE`;
}

export const assertResponderPolicySnapshotSafe = captureResponderSnapshot;
