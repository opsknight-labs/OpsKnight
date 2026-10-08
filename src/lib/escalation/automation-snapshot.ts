import { z } from 'zod';
import { EscalationTargetType, NotificationChannel, type Prisma } from '@prisma/client';

// Freeze policy behavior, while schedule occupants, team membership and recipient
// availability continue to resolve at execution time through the target resolver.
export const responderSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(
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
      conditions: z.array(
        z.object({ field: z.string(), operator: z.string(), values: z.array(z.string()) })
      ),
    })
  ),
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
  return responderSnapshotSchema.parse(policy);
}
