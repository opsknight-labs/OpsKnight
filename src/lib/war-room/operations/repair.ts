import 'server-only';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { emitAuditEvent } from '@/lib/audit';
import type { WarRoomRepairAction, WarRoomRepairRequest, WarRoomRepairResult } from './types';

export const repairActionSchema = z.object({
  warRoomId: z.string().trim().min(1, 'warRoomId is required'),
  action: z.enum(['TEST_CONNECTION', 'RECONCILE', 'RETRY_PROJECTION', 'RETRY_PARTICIPANT_SYNC', 'RETRY_EXTERNAL_CLEANUP', 'REFRESH_PERMISSIONS']),
});

export async function enqueueWarRoomRepair(input: WarRoomRepairRequest): Promise<WarRoomRepairResult> {
  const parsed = repairActionSchema.safeParse({ warRoomId: input.warRoomId, action: input.action });
  if (!parsed.success) {
    return { accepted: false, reasonCode: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message ?? 'Invalid repair request.' };
  }

  // RBAC + state gate: repairs require ADMIN or RESPONDER and a live room
  const { getCurrentUser } = await import('@/lib/rbac');
  try {
    const user = await getCurrentUser();
    if (!['ADMIN', 'RESPONDER'].includes(user.role)) {
      return { accepted: false, reasonCode: 'FORBIDDEN', message: 'Repair actions require Admin or Responder.' };
    }
  } catch {
    return { accepted: false, reasonCode: 'UNAUTHORIZED', message: 'Authentication required.' };
  }

  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: input.warRoomId },
    select: { id: true, incidentId: true, provider: true, state: true, health: true, provisioningToken: true, projectionVersion: true, externalCleanupPending: true, destinationId: true },
  });
  if (!room) return { accepted: false, reasonCode: 'NOT_FOUND', message: 'War room was not found.' };

  // Deleted/disabled integration guard — repairs still enqueue reconciliations for triage, but TEST_CONNECTION is allowed
  const action = input.action as WarRoomRepairAction;

  let jobId: string | null = null;
  let jobType: string | null = null;

  try {
    switch (action) {
      case 'TEST_CONNECTION': {
        // UI → Admin API → enqueue durable test: provider-neutral "test connection" is a RECONCILE probe.
        // For Teams, testMicrosoftTeamsConnection(destinationId) would require Graph; repair enqueues RECONCILE instead.
        const existing = await prisma.backgroundJob.findFirst({
          where: { type: 'WAR_ROOM_RECONCILE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
          select: { id: true },
        });
        if (existing) {
          jobId = existing.id;
          jobType = 'WAR_ROOM_RECONCILE';
          break;
        }
        const job = await prisma.backgroundJob.create({
          data: { type: 'WAR_ROOM_RECONCILE', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 3, payload: { warRoomId: room.id } as unknown as never },
        });
        jobId = job.id;
        jobType = 'WAR_ROOM_RECONCILE';
        break;
      }
      case 'RECONCILE': {
        if (room.state === 'AMBIGUOUS' && room.provisioningToken) {
          // AMBIGUOUS → provisioning reconciliation (marker-only, never POST)
          const existing = await prisma.backgroundJob.findFirst({
            where: {
              type: 'WAR_ROOM_PROVISION',
              status: { in: ['PENDING', 'PROCESSING'] },
              AND: [
                { payload: { path: ['warRoomId'], equals: room.id } },
                { payload: { path: ['provisioningToken'], equals: room.provisioningToken } },
                { payload: { path: ['reconciliationOnly'], equals: true } },
              ],
            },
            select: { id: true },
          });
          if (existing) {
            jobId = existing.id;
            jobType = 'WAR_ROOM_PROVISION';
            break;
          }
          const job = await prisma.backgroundJob.create({
            data: { type: 'WAR_ROOM_PROVISION', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 6, payload: { warRoomId: room.id, provisioningToken: room.provisioningToken, reconciliationOnly: true } as unknown as never },
          });
          jobId = job.id;
          jobType = 'WAR_ROOM_PROVISION';
          break;
        }
        // READY/CLOSING → health reconciliation
        if (!['READY', 'CLOSING', 'FAILED'].includes(room.state)) {
          return { accepted: false, reasonCode: 'STATE_NOT_RECONCILABLE', message: `Reconciliation is not applicable while war-room state is ${room.state}.` };
        }
        {
          const existing = await prisma.backgroundJob.findFirst({
            where: { type: 'WAR_ROOM_RECONCILE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
            select: { id: true },
          });
          if (existing) {
            jobId = existing.id;
            jobType = 'WAR_ROOM_RECONCILE';
            break;
          }
          const job = await prisma.backgroundJob.create({
            data: { type: 'WAR_ROOM_RECONCILE', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 3, payload: { warRoomId: room.id } as unknown as never },
          });
          jobId = job.id;
          jobType = 'WAR_ROOM_RECONCILE';
          break;
        }
      }
      case 'RETRY_PROJECTION': {
        if (!['READY', 'CLOSING'].includes(room.state)) {
          return { accepted: false, reasonCode: 'STATE_NOT_READY', message: 'Projection can only be retried while the war room is READY or CLOSING.' };
        }
        // Idempotent: coalesce by warRoomId+projectionVersion if a job for current version already exists
        const existing = await prisma.backgroundJob.findFirst({
          where: {
            type: 'WAR_ROOM_PROJECT',
            status: { in: ['PENDING', 'PROCESSING'] },
            AND: [
              { payload: { path: ['warRoomId'], equals: room.id } },
              { payload: { path: ['projectionVersion'], equals: room.projectionVersion } },
            ],
          },
          select: { id: true },
        });
        if (existing) {
          jobId = existing.id;
          jobType = 'WAR_ROOM_PROJECT';
          break;
        }
        // Increment projection atomically and enqueue new version
        const updated = await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, state: { in: ['READY', 'CLOSING'] } },
          data: { projectionVersion: { increment: 1 } },
        });
        if (updated.count !== 1) {
          return { accepted: false, reasonCode: 'STATE_CHANGED', message: 'War-room state changed before projection could be queued.' };
        }
        const fresh = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { projectionVersion: true } });
        const version = fresh!.projectionVersion;
        const job = await prisma.backgroundJob.create({
          data: { type: 'WAR_ROOM_PROJECT', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5, payload: { warRoomId: room.id, projectionVersion: version } as unknown as never },
        });
        jobId = job.id;
        jobType = 'WAR_ROOM_PROJECT';
        break;
      }
      case 'RETRY_PARTICIPANT_SYNC': {
        if (!['READY', 'CLOSING'].includes(room.state)) {
          return { accepted: false, reasonCode: 'STATE_NOT_READY', message: 'Participant sync can only be retried while the war room is READY or CLOSING.' };
        }
        {
          const existing = await prisma.backgroundJob.findFirst({
            where: { type: 'WAR_ROOM_PARTICIPANT_SYNC', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
            select: { id: true },
          });
          if (existing) {
            jobId = existing.id;
            jobType = 'WAR_ROOM_PARTICIPANT_SYNC';
            break;
          }
          const job = await prisma.backgroundJob.create({
            data: { type: 'WAR_ROOM_PARTICIPANT_SYNC', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5, payload: { warRoomId: room.id } as unknown as never },
          });
          jobId = job.id;
          jobType = 'WAR_ROOM_PARTICIPANT_SYNC';
          break;
        }
      }
      case 'RETRY_EXTERNAL_CLEANUP': {
        // Enqueue through the terminal drift lane via a synthetic reconcile; deduped and idempotent — never calls Graph directly.
        const existing = await prisma.backgroundJob.findFirst({
          where: {
            type: 'WAR_ROOM_RECONCILE',
            status: { in: ['PENDING', 'PROCESSING'] },
            AND: [
              { payload: { path: ['warRoomId'], equals: room.id } },
              { payload: { path: ['reason'], equals: 'external_cleanup_retry' } },
            ],
          },
          select: { id: true },
        });
        if (existing) {
          jobId = existing.id;
          jobType = 'WAR_ROOM_RECONCILE';
          break;
        }
        const laneJob = await prisma.backgroundJob.create({
          data: {
            type: 'WAR_ROOM_RECONCILE',
            status: 'PENDING',
            scheduledAt: new Date(),
            maxAttempts: 3,
            payload: { warRoomId: room.id, reason: 'external_cleanup_retry' } as unknown as never,
          },
        });
        jobId = laneJob.id;
        jobType = 'WAR_ROOM_RECONCILE';
        break;
      }
      case 'REFRESH_PERMISSIONS': {
        // Permission refresh = enqueue a reconciliation that re-probes RSC / installation state
        const existing = await prisma.backgroundJob.findFirst({
          where: { type: 'WAR_ROOM_RECONCILE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
          select: { id: true },
        });
        if (existing) {
          jobId = existing.id;
          jobType = 'WAR_ROOM_RECONCILE';
          break;
        }
        const job = await prisma.backgroundJob.create({
          data: { type: 'WAR_ROOM_RECONCILE', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 3, payload: { warRoomId: room.id, reason: 'permission_refresh' } as unknown as never },
        });
        jobId = job.id;
        jobType = 'WAR_ROOM_RECONCILE';
        break;
      }
      default:
        return { accepted: false, reasonCode: 'UNSUPPORTED_ACTION', message: `Unsupported repair action: ${action}` };
    }
  } catch (error) {
    return { accepted: false, reasonCode: 'ENQUEUE_FAILED', message: error instanceof Error ? error.message : String(error) };
  }

  // Structured audit — actor/provider/warRoomId/incidentId/action/result/reason/timestamp + auto vs operator
  const auditActionMap: Record<WarRoomRepairAction, string> = {
    TEST_CONNECTION: 'TEAMS_CONNECTION_TESTED',
    RECONCILE: 'WAR_ROOM_RECONCILIATION_REQUESTED',
    RETRY_PROJECTION: 'WAR_ROOM_PROJECTION_RETRY_REQUESTED',
    RETRY_PARTICIPANT_SYNC: 'WAR_ROOM_PARTICIPANT_SYNC_REQUESTED',
    RETRY_EXTERNAL_CLEANUP: 'WAR_ROOM_EXTERNAL_CLEANUP_RETRY_REQUESTED',
    REFRESH_PERMISSIONS: 'TEAMS_PERMISSIONS_REFRESHED',
  };
  const isJobReused = jobId != null && jobType != null;
  try {
    await emitAuditEvent({
      action: auditActionMap[action],
      source: 'UI',
      target: { type: 'SYSTEM_CONFIG', id: room.id },
      actor: { type: 'USER', id: input.actorId, email: input.actorEmail ?? undefined },
      metadata: {
        provider: room.provider,
        warRoomId: room.id,
        incidentId: room.incidentId,
        action,
        result: isJobReused ? 'accepted' : 'rejected',
        reason: input.reason ?? null,
        jobId: jobId ?? null,
        jobType: jobType ?? null,
        // Distinguish operator vs automated reconciliation
        initiatedBy: 'operator',
        actorId: input.actorId,
        timestamp: new Date().toISOString(),
      } as unknown as never,
    });
  } catch {}

  addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: String(room.provider), result: 'repair_enqueued' } as never);

  return { accepted: true, jobId, jobType };
}
