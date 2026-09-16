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

  // Admin Control Plane — mutations are ADMIN-only (see /api/admin/war-rooms/*)
  const { getCurrentUser } = await import('@/lib/rbac');
  try {
    const user = await getCurrentUser();
    if (user.role !== 'ADMIN') {
      return { accepted: false, reasonCode: 'FORBIDDEN', message: 'Repair actions require Admin.' };
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
        // Provider connection test: Entra+Graph+bot+RSC+destination probe via durable job.
        // Worker routes `reason=connection_test` → probeMicrosoftTeamsChannelHealth + reconcile.
        const existing = await prisma.backgroundJob.findFirst({
          where: {
            type: 'WAR_ROOM_RECONCILE',
            status: { in: ['PENDING', 'PROCESSING'] },
            AND: [
              { payload: { path: ['warRoomId'], equals: room.id } },
              { payload: { path: ['reason'], equals: 'connection_test' } },
            ],
          },
          select: { id: true },
        });
        if (existing) {
          jobId = existing.id;
          jobType = 'WAR_ROOM_RECONCILE';
          break;
        }
        const job = await prisma.backgroundJob.create({
          data: { type: 'WAR_ROOM_RECONCILE', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 3, payload: { warRoomId: room.id, reason: 'connection_test' } as unknown as never },
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
        // Transactional + idempotent: coalesce inside the transaction so two
        // concurrent admins cannot both increment projection. Uses the neutral
        // helper that increments + enqueues in one tx.
        const { requestWarRoomProjectionNeutral } = await import('../engine');
        const version = await requestWarRoomProjectionNeutral(room.id);
        if (version == null) {
          // Already coalesced race — reuse the pending job for current version
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
          return { accepted: false, reasonCode: 'STATE_CHANGED', message: 'War-room state changed before projection could be queued.' };
        }
        const job = await prisma.backgroundJob.findFirst({
          where: {
            type: 'WAR_ROOM_PROJECT',
            status: { in: ['PENDING', 'PROCESSING'] },
            AND: [
              { payload: { path: ['warRoomId'], equals: room.id } },
              { payload: { path: ['projectionVersion'], equals: version } },
            ],
          },
          select: { id: true },
        });
        jobId = job?.id ?? null;
        jobType = 'WAR_ROOM_PROJECT';
        // If helper already created the job, reuse it; otherwise fall through
        if (jobId) break;
        // Fallback: helper incremented but job lookup missed (test mock) — create if needed
        const fallback = await prisma.backgroundJob.create({
          data: { type: 'WAR_ROOM_PROJECT', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5, payload: { warRoomId: room.id, projectionVersion: version } as unknown as never },
        });
        jobId = fallback.id;
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
        // Targeted terminal-drift retry: invoke the real orphan lane for this
        // single room immediately, then also ensure the periodic sweep will
        // retry. Enqueues a synthetic reconcile that the worker routes to
        // reconcileTerminalWarRoomDrift for this warRoomId.
        // Deduped: if a cleanup-retry job already exists, reuse it.
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
        // Bump lastAttempt so the cron lane is eligible immediately, then enqueue targeted job.
        try {
          await prisma.incidentWarRoom.updateMany({
            where: { id: room.id, externalCleanupPending: true },
            data: { externalCleanupLastAttemptAt: new Date(Date.now() - 6 * 60_000) },
          });
        } catch {}
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
        // Durable RSC probe: enqueues a reconcile with permission_refresh so the
        // worker can refresh RSC grants (getTeamsGrantedRscPermissions) for the
        // room's team before running normal health reconciliation.
        const existing = await prisma.backgroundJob.findFirst({
          where: {
            type: 'WAR_ROOM_RECONCILE',
            status: { in: ['PENDING', 'PROCESSING'] },
            payload: { path: ['warRoomId'], equals: room.id } },
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
      // eslint-disable-next-line security/detect-object-injection -- action is validated by z.enum at entry
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
