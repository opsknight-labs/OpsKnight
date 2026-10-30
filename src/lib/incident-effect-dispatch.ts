import { z } from 'zod/v3';
import { IncidentStatus, Prisma } from '@prisma/client';
import { runReadCommittedTransaction } from './db-utils';
import { getEventSideEffectLane, type EventSideEffect } from './event-outbox';
import { listWarRoomProviders } from './war-room/registry';

const dispatchSchema = z
  .object({
    task: z.literal('EVENT_SIDE_EFFECT'),
    effect: z.literal('DISPATCH_ORDINARY'),
    lane: z.literal('ORDINARY_DISPATCH'),
    incidentId: z.string().min(1),
    eventOrderAt: z.string().datetime({ offset: true }),
    sourceEventId: z.string().min(1),
    escalationGeneration: z.number().int().nonnegative().optional(),
    incidentStatus: z.nativeEnum(IncidentStatus).optional(),
    lifecycle: z
      .object({
        command: z.string(),
        source: z.string(),
        previousStatus: z.nativeEnum(IncidentStatus),
        status: z.nativeEnum(IncidentStatus),
        transitionAt: z.string().datetime({ offset: true }),
        snoozedUntil: z.string().datetime({ offset: true }).nullable(),
      })
      .optional(),
    warRoom: z
      .object({
        message: z.string().optional(),
        userId: z.string().optional(),
        teamId: z.string().optional(),
      })
      .optional(),
    dispatch: z
      .object({ version: z.literal(1), effects: z.array(z.string()).min(1).max(32) })
      .strict(),
  })
  .strict();

/** The row lock, child intents and parent completion are one transaction.
 * Provider workers alone perform external I/O. A lost claim cannot publish work.
 */
export async function dispatchIncidentEffects(
  jobId: string,
  attempt: number | undefined,
  token: string | null | undefined
): Promise<boolean> {
  if (!token || !Number.isSafeInteger(attempt) || (attempt ?? 0) < 1)
    throw new Error('Incident dispatch requires a fenced claim');
  return runReadCommittedTransaction(async tx => {
    const [parent] = await tx.$queryRaw<Array<{ payload: Prisma.JsonValue; createdAt: Date }>>`
      SELECT payload, "createdAt" FROM "BackgroundJob" WHERE id=${jobId}
        AND status='PROCESSING_V2'::"JobStatus" AND attempts=${attempt}
        AND "claimToken"=${token}::uuid FOR UPDATE
    `;
    if (!parent) return false;
    const payload = dispatchSchema.parse(parent.payload);
    const effects = payload.dispatch.effects.map(value => {
      const effect = value as EventSideEffect;
      const lane = getEventSideEffectLane(effect);
      if (!lane || lane === 'PERSONAL_NOTIFICATION' || lane === 'ORDINARY_DISPATCH')
        throw new Error('Invalid ordinary incident effect');
      return effect;
    });
    if (new Set(effects).size !== effects.length)
      throw new Error('Duplicate ordinary incident effect');
    const service = await tx.incident.findUnique({
      where: { id: payload.incidentId },
      select: {
        service: {
          select: {
            serviceNotificationChannels: true,
            webhookUrl: true,
            _count: {
              select: {
                statusPageServices: {
                  where: {
                    showOnPage: true,
                    statusPage: { enabled: true, showIncidents: true },
                  },
                },
              },
            },
          },
        },
      },
    });
    const chatOps = effects.includes('TRIGGER_WAR_ROOM')
      ? await tx.chatOpsConfig.findUnique({ where: { id: 'default' }, select: { enabled: true } })
      : undefined;
    const customCollaboration = listWarRoomProviders().some(
      adapter => adapter.usesChatOpsPolicy !== true
    );
    const planned = service
      ? effects.filter(effect => {
          if (effect === 'TRIGGER_WEBHOOK' || effect === 'TRIGGER_STATUS_PAGE')
            return service.service._count.statusPageServices > 0;
          if (effect === 'TRIGGER_SERVICE_NOTIFICATION')
            return (
              service.service.serviceNotificationChannels.length > 0 ||
              Boolean(service.service.webhookUrl)
            );
          if (effect === 'TRIGGER_WAR_ROOM')
            return customCollaboration || chatOps?.enabled === true;
          // Lifecycle/custom work retains its existing execution-time handler and
          // recovery semantics until a dedicated omission contract has been proven.
          return true;
        })
      : [];
    if (planned.length) {
      const { dispatch: _dispatch, ...context } = payload;
      void _dispatch;
      await tx.backgroundJob.createMany({
        data: planned.map((effect, ordinal) => ({
          id: `${jobId}:${ordinal.toString().padStart(2, '0')}:${effect}`,
          createdAt: parent.createdAt,
          type: 'SCHEDULED_TASK',
          status: 'PENDING',
          scheduledAt: new Date(payload.eventOrderAt),
          maxAttempts: 5,
          payload: {
            ...context,
            dispatchOrderId: jobId,
            effect,
            lane: getEventSideEffectLane(effect),
          } as Prisma.InputJsonObject,
        })),
      });
    }
    // The lock retains the exact claim through commit. No separate completion
    // call may leave committed children attached to a retryable parent.
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    return true;
  });
}
