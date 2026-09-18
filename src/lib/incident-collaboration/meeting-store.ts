/**
 * Incident Meeting Persistence and Provisioning Service
 *
 * Persists canonical incident meetings in the IncidentMeeting Prisma table with
 * CAS generation, fencing tokens, durable state machine transitions, and
 * full protection against race conditions (e.g. provision overwriting a close).
 */

import prisma from '@/lib/prisma';
import crypto from 'crypto';
import type { IncidentMeetingProvider, IncidentMeetingView } from './types';
import { MeetingProviderRegistry } from './meeting-registry';
import {
  recordMeetingProvisionOutcome,
  observeMeetingProvisionDuration,
  recordMeetingCloseOutcome,
  observeMeetingCloseDuration,
  recordMeetingRetry,
  type MeetingMetricRetryReason,
} from './meeting-metrics';
import { emitMeetingAuditEvent } from './meeting-audit';
import { WarRoomRetryableError } from '@/lib/war-room/errors';
export {
  reconcileIncidentMeeting,
  reconcileStalledMeetingProvisions,
  reconcileMeetingCleanupDebt,
  reconcileMeetingProjectionDrift,
  retryIncidentMeetingCleanup,
} from './meeting-reconciliation';

export const INCIDENT_MEETING_PREFIX = 'incident_meeting:';

// In-memory fallback for unit testing environments without full DB
const memoryMeetingCache = new Map<string, IncidentMeetingView>();

function classifyRetryReason(error: unknown): MeetingMetricRetryReason {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('ratelimit'))
    return 'rate_limit';
  if (msg.includes('401') || msg.includes('403') || msg.includes('permission')) return 'permission';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504'))
    return 'provider_5xx';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('timedout'))
    return 'timeout';
  return 'network';
}

function mapRecordToView(record: {
  id: string;
  incidentId: string;
  generation: number;
  provider: string;
  state: string;
  health: string;
  externalId: string;
  joinUrl: string;
  joinWebUrl?: string | null;
  conferenceId?: string | null;
  tollNumber?: string | null;
  tollFreeNumber?: string | null;
  organizerEmail?: string | null;
  providerMeetingId?: string | null;
  createdAt: Date | string;
  readyAt?: Date | string | null;
  closedAt?: Date | string | null;
  closeStartedAt?: Date | string | null;
  closeToken?: string | null;
  cleanupAttemptedAt?: Date | string | null;
  cleanupRetryCount?: number | null;
  lastReconciledAt?: Date | string | null;
  externalCleanupPending?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): IncidentMeetingView {
  const isReady = record.state === 'READY';
  const isFailed = record.state === 'FAILED';
  const isProvisioning = record.state === 'PROVISIONING';
  const isTeams = record.provider === 'MICROSOFT_TEAMS';

  return {
    id: record.id,
    incidentId: record.incidentId,
    generation: record.generation,
    provider: record.provider as IncidentMeetingProvider,
    state: record.state as IncidentMeetingView['state'],
    health: record.health as IncidentMeetingView['health'],
    externalId: record.externalId,
    joinUrl: record.joinUrl,
    joinWebUrl: record.joinWebUrl ?? null,
    conferenceId: record.conferenceId ?? null,
    tollNumber: record.tollNumber ?? null,
    organizerEmail: record.organizerEmail ?? null,
    providerMeetingId: record.providerMeetingId ?? null,
    createdAt:
      typeof record.createdAt === 'string' ? record.createdAt : record.createdAt.toISOString(),
    readyAt: record.readyAt
      ? typeof record.readyAt === 'string'
        ? record.readyAt
        : record.readyAt.toISOString()
      : null,
    closedAt: record.closedAt
      ? typeof record.closedAt === 'string'
        ? record.closedAt
        : record.closedAt.toISOString()
      : null,
    closeStartedAt: record.closeStartedAt
      ? typeof record.closeStartedAt === 'string'
        ? record.closeStartedAt
        : record.closeStartedAt.toISOString()
      : null,
    closeToken: record.closeToken ?? null,
    cleanupAttemptedAt: record.cleanupAttemptedAt
      ? typeof record.cleanupAttemptedAt === 'string'
        ? record.cleanupAttemptedAt
        : record.cleanupAttemptedAt.toISOString()
      : null,
    cleanupRetryCount: record.cleanupRetryCount ?? 0,
    lastReconciledAt: record.lastReconciledAt
      ? typeof record.lastReconciledAt === 'string'
        ? record.lastReconciledAt
        : record.lastReconciledAt.toISOString()
      : null,
    externalCleanupPending: record.externalCleanupPending ?? false,
    lastErrorCode: record.lastErrorCode ?? null,
    lastErrorMessage: record.lastErrorMessage ?? null,
    actions: {
      canJoin: isReady,
      canProvision: record.state === 'REQUESTED',
      canRetry: isFailed,
      canClose: isReady || isProvisioning,
      supportsExternalClose: isTeams,
      closeLabel: isTeams ? 'End Meeting' : 'Detach Bridge',
    },
  };
}

/**
 * Fetch persisted canonical incident meeting view.
 * Pure database read with zero side-effects and zero external network calls.
 */
export async function getIncidentMeeting(incidentId: string): Promise<IncidentMeetingView | null> {
  if (prisma?.incidentMeeting?.findFirst) {
    try {
      const record = await prisma.incidentMeeting.findFirst({
        where: { incidentId },
        orderBy: { generation: 'desc' },
      });
      if (record) {
        const view = mapRecordToView(record);
        memoryMeetingCache.set(incidentId, view);
        return view;
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'test' || process.env.VITEST_USE_REAL_DB === '1') {
        throw e;
      }
    }
  }

  return memoryMeetingCache.get(incidentId) || null;
}

/**
 * Persist or update incident meeting view to canonical IncidentMeeting table.
 */
export async function saveIncidentMeeting(meeting: IncidentMeetingView): Promise<void> {
  memoryMeetingCache.set(meeting.incidentId, meeting);

  if (prisma?.incidentMeeting?.upsert) {
    try {
      await prisma.incidentMeeting.upsert({
        where: {
          incidentId_generation: {
            incidentId: meeting.incidentId,
            generation: meeting.generation,
          },
        },
        create: {
          id: meeting.id,
          incidentId: meeting.incidentId,
          provider: meeting.provider as never,
          generation: meeting.generation,
          state: meeting.state as never,
          health: meeting.health as never,
          externalId: meeting.externalId,
          joinUrl: meeting.joinUrl,
          joinWebUrl: meeting.joinWebUrl ?? null,
          conferenceId: meeting.conferenceId ?? null,
          tollNumber: meeting.tollNumber ?? null,
          organizerEmail: meeting.organizerEmail ?? null,
          lastErrorCode: meeting.lastErrorCode ?? null,
          lastErrorMessage: meeting.lastErrorMessage ?? null,
          closedAt: meeting.closedAt ? new Date(meeting.closedAt) : null,
          closeStartedAt: meeting.closeStartedAt ? new Date(meeting.closeStartedAt) : null,
          closeToken: meeting.closeToken ?? null,
          cleanupAttemptedAt: meeting.cleanupAttemptedAt
            ? new Date(meeting.cleanupAttemptedAt)
            : null,
          cleanupRetryCount: meeting.cleanupRetryCount ?? 0,
          lastReconciledAt: meeting.lastReconciledAt ? new Date(meeting.lastReconciledAt) : null,
          externalCleanupPending: meeting.externalCleanupPending ?? false,
          readyAt: meeting.state === 'READY' ? new Date() : null,
        },
        update: {
          state: meeting.state as never,
          health: meeting.health as never,
          joinUrl: meeting.joinUrl,
          joinWebUrl: meeting.joinWebUrl ?? null,
          conferenceId: meeting.conferenceId ?? null,
          tollNumber: meeting.tollNumber ?? null,
          organizerEmail: meeting.organizerEmail ?? null,
          lastErrorCode: meeting.lastErrorCode ?? null,
          lastErrorMessage: meeting.lastErrorMessage ?? null,
          closedAt: meeting.closedAt ? new Date(meeting.closedAt) : null,
          closeStartedAt: meeting.closeStartedAt ? new Date(meeting.closeStartedAt) : undefined,
          closeToken: meeting.closeToken !== undefined ? meeting.closeToken : undefined,
          cleanupAttemptedAt: meeting.cleanupAttemptedAt
            ? new Date(meeting.cleanupAttemptedAt)
            : undefined,
          cleanupRetryCount:
            meeting.cleanupRetryCount !== undefined ? meeting.cleanupRetryCount : undefined,
          lastReconciledAt: meeting.lastReconciledAt
            ? new Date(meeting.lastReconciledAt)
            : undefined,
          externalCleanupPending:
            meeting.externalCleanupPending !== undefined
              ? meeting.externalCleanupPending
              : undefined,
          readyAt: meeting.state === 'READY' ? new Date() : undefined,
        },
      });
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        throw e;
      }
    }
  }
}

/**
 * Provision or retrieve canonical incident meeting bridge.
 * Enforces atomic state transitions, fencing tokens, and CAS protection:
 * If closeIncidentMeeting() is invoked while external provisioning is in-flight,
 * the closed state takes absolute precedence and will not be overwritten with READY.
 */
export async function provisionIncidentMeeting(params: {
  incidentId: string;
  incidentNumber?: number;
  incidentTitle: string;
  provider: IncidentMeetingProvider;
  generation?: number;
  customTemplate?: string | null;
  forceRetry?: boolean;
}): Promise<IncidentMeetingView> {
  const {
    incidentId,
    incidentNumber,
    incidentTitle,
    provider,
    customTemplate,
    forceRetry = false,
  } = params;

  if (provider === 'NONE') {
    throw new Error('Cannot provision meeting for provider NONE.');
  }

  const existing = await getIncidentMeeting(incidentId);

  // If already ready and same provider and not force retry, return existing meeting
  if (existing && existing.state === 'READY' && existing.provider === provider && !forceRetry) {
    return existing;
  }

  const generation = params.generation ?? (existing ? existing.generation + 1 : 1);
  const meetingId = `meet_${incidentId}_${generation}`;
  const externalId = `opsknight:${incidentId}:${generation}`;
  const provisioningToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Optimistic initial meeting view with PROVISIONING state
  const initialMeeting: IncidentMeetingView = {
    id: meetingId,
    incidentId,
    generation,
    provider,
    state: 'PROVISIONING',
    health: 'HEALTHY',
    externalId,
    joinUrl: existing?.joinUrl || '',
    createdAt: now,
    actions: {
      canJoin: false,
      canProvision: false,
      canRetry: false,
      canClose: false,
    },
  };

  await saveIncidentMeeting(initialMeeting);

  // Store fencing token in DB record if table is present
  if (prisma?.incidentMeeting?.updateMany) {
    await prisma.incidentMeeting
      .updateMany({
        where: { incidentId, generation },
        data: {
          provisioningToken,
          provisioningStartedAt: new Date(),
        },
      })
      .catch(() => null);
  }

  return executeMeetingProvision({
    incidentId,
    provisioningToken,
    provider,
    generation,
    incidentTitle,
    incidentNumber,
    customTemplate,
  });
}

/**
 * Request asynchronous meeting bridge provisioning via durable background job.
 * Sets the meeting record to PROVISIONING with a fencing token and immediately returns
 * the optimistic view so the client UI can reactively poll or await completion.
 */
export async function requestMeetingProvision(params: {
  incidentId: string;
  incidentNumber?: number;
  incidentTitle: string;
  provider: IncidentMeetingProvider;
  generation?: number;
  customTemplate?: string | null;
  forceRetry?: boolean;
}): Promise<IncidentMeetingView> {
  const {
    incidentId,
    incidentNumber,
    incidentTitle,
    provider,
    customTemplate,
    forceRetry = false,
  } = params;

  if (provider === 'NONE') {
    throw new Error('Cannot provision meeting for provider NONE.');
  }

  // 1. Check existing state before database mutation
  const existing = await getIncidentMeeting(incidentId);
  if (existing && existing.state === 'READY' && existing.provider === provider && !forceRetry) {
    return existing;
  }
  if (existing && existing.state === 'PROVISIONING' && !forceRetry) {
    // Concurrent claim protection: return active provisioning meeting
    return existing;
  }
  if (existing && existing.state === 'CLOSING') {
    return existing;
  }

  // 2. Transactional claim: atomic generation claim and job creation
  if (prisma?.incidentMeeting && prisma?.backgroundJob) {
    try {
      const meetingView = await prisma.$transaction(async tx => {
        // Re-check inside transaction to eliminate TOCTOU races
        const current = await tx.incidentMeeting.findFirst({
          where: { incidentId },
          orderBy: { generation: 'desc' },
        });

        if (current) {
          if (current.state === 'READY' && current.provider === provider && !forceRetry) {
            return mapRecordToView(current);
          }
          if (current.state === 'PROVISIONING' && !forceRetry) {
            return mapRecordToView(current);
          }
          if (current.state === 'CLOSING') {
            return mapRecordToView(current);
          }
        }

        const targetGeneration =
          params.generation ??
          (forceRetry && current && current.state === 'FAILED'
            ? current.generation + 1
            : current
              ? current.generation + 1
              : 1);

        const meetingId = `meet_${incidentId}_${targetGeneration}`;
        const externalId = `opsknight:${incidentId}:${targetGeneration}`;
        const provisioningToken = crypto.randomUUID();

        let isWinner = false;
        if (typeof tx.incidentMeeting.createMany === 'function') {
          const insertResult = await tx.incidentMeeting.createMany({
            data: [
              {
                id: meetingId,
                incidentId,
                provider: provider as never,
                generation: targetGeneration,
                state: 'PROVISIONING',
                health: 'HEALTHY',
                externalId,
                joinUrl: '',
                provisioningToken,
                provisioningStartedAt: new Date(),
              },
            ],
            skipDuplicates: true,
          });
          isWinner = insertResult.count > 0;
        } else {
          try {
            await tx.incidentMeeting.create({
              data: {
                id: meetingId,
                incidentId,
                provider: provider as never,
                generation: targetGeneration,
                state: 'PROVISIONING',
                health: 'HEALTHY',
                externalId,
                joinUrl: '',
                provisioningToken,
                provisioningStartedAt: new Date(),
              },
            });
            isWinner = true;
          } catch {
            isWinner = false;
          }
        }

        const activeRecord = await tx.incidentMeeting.findUnique({
          where: { incidentId_generation: { incidentId, generation: targetGeneration } },
        });

        if (!activeRecord) {
          throw new Error('Failed to retrieve incident meeting claim.');
        }

        if (isWinner) {
          await tx.backgroundJob.create({
            data: {
              type: 'MEETING_PROVISION',
              status: 'PENDING',
              scheduledAt: new Date(),
              maxAttempts: 5,
              payload: {
                incidentId,
                provisioningToken,
                provider,
                generation: targetGeneration,
                incidentTitle,
                incidentNumber,
                customTemplate: customTemplate || null,
              },
            },
          });
        }

        return mapRecordToView(activeRecord);
      });

      memoryMeetingCache.set(incidentId, meetingView);
      return meetingView;
    } catch (err) {
      // In production, FAIL CLOSED! Database failures must never spawn un-tracked external meetings.
      if (process.env.NODE_ENV !== 'test') {
        throw err;
      }
    }
  }

  // 3. Fallback path for unit test / mock environments where Prisma is null or mock
  const fallbackGen = params.generation ?? (existing ? existing.generation + 1 : 1);
  const fallbackMeetingId = `meet_${incidentId}_${fallbackGen}`;
  const fallbackExternalId = `opsknight:${incidentId}:${fallbackGen}`;
  const fallbackToken = crypto.randomUUID();
  const now = new Date().toISOString();

  const fallbackMeeting: IncidentMeetingView = {
    id: fallbackMeetingId,
    incidentId,
    generation: fallbackGen,
    provider,
    state: 'PROVISIONING',
    health: 'HEALTHY',
    externalId: fallbackExternalId,
    joinUrl: existing?.joinUrl || '',
    createdAt: now,
    actions: {
      canJoin: false,
      canProvision: false,
      canRetry: false,
      canClose: true,
      supportsExternalClose: provider === 'MICROSOFT_TEAMS',
      closeLabel: provider === 'MICROSOFT_TEAMS' ? 'End Meeting' : 'Detach Bridge',
    },
  };

  await saveIncidentMeeting(fallbackMeeting);

  return executeMeetingProvision({
    incidentId,
    provisioningToken: fallbackToken,
    provider,
    generation: fallbackGen,
    incidentTitle,
    incidentNumber,
    customTemplate,
  });
}

export function isRetryableMeetingError(error: unknown): boolean {
  if (!error) return false;
  if (
    error instanceof WarRoomRetryableError ||
    (typeof error === 'object' &&
      error !== null &&
      (('name' in error && error.name === 'WarRoomRetryableError') ||
        ('retryable' in error && Boolean((error as { retryable?: boolean }).retryable))))
  ) {
    return true;
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('timedout') ||
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

/**
 * Execute meeting provisioning with atomic CAS fencing.
 * Called either synchronously by provisionIncidentMeeting or asynchronously by the MEETING_PROVISION job worker.
 * Guarantees that an in-flight provision NEVER overwrites a CLOSED state (TOCTOU protection).
 */
export async function executeMeetingProvision(params: {
  incidentId: string;
  provisioningToken: string;
  provider: IncidentMeetingProvider;
  generation?: number;
  incidentTitle?: string;
  incidentNumber?: number;
  customTemplate?: string | null;
  attempt?: number;
  maxAttempts?: number;
}): Promise<IncidentMeetingView> {
  const {
    incidentId,
    provisioningToken,
    provider,
    generation,
    incidentTitle = 'Incident Meeting',
    incidentNumber,
    customTemplate,
  } = params;

  const currentStatus = await getIncidentMeeting(incidentId);
  if (currentStatus && (currentStatus.state === 'CLOSED' || currentStatus.state === 'CLOSING')) {
    return currentStatus;
  }

  const gen = generation ?? currentStatus?.generation ?? 1;
  const meetingId = `meet_${incidentId}_${gen}`;
  const externalId = `opsknight:${incidentId}:${gen}`;
  const now = new Date().toISOString();

  let dbHasRecord = false;
  if (prisma?.incidentMeeting?.findFirst) {
    try {
      const row = await prisma.incidentMeeting.findFirst({
        where: { incidentId, generation: gen },
        select: { state: true, provisioningToken: true },
      });
      if (row) {
        dbHasRecord = true;
        if (row.state === 'CLOSED' || row.state === 'CLOSING') {
          return (
            (await getIncidentMeeting(incidentId)) || {
              id: meetingId,
              incidentId,
              generation: gen,
              provider,
              state: 'CLOSED',
              health: 'HEALTHY',
              externalId,
              joinUrl: '',
              createdAt: now,
              closedAt: now,
              actions: { canJoin: false, canProvision: false, canRetry: false, canClose: false },
            }
          );
        }
        if (row.state !== 'PROVISIONING') {
          return (await getIncidentMeeting(incidentId)) || currentStatus!;
        }
        if (
          provisioningToken &&
          row.provisioningToken &&
          row.provisioningToken !== provisioningToken
        ) {
          // Token mismatch: another claim or generation owns this meeting now. Abort before calling provider!
          return (await getIncidentMeeting(incidentId)) || currentStatus!;
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        throw e;
      }
    }
  }

  const startedAt = performance.now();
  try {
    const result = await MeetingProviderRegistry.createOrGetMeeting(provider, {
      incidentId,
      incidentNumber,
      incidentTitle,
      generation: gen,
      customTemplate,
    });

    const durationSeconds = (performance.now() - startedAt) / 1000;
    observeMeetingProvisionDuration(provider, durationSeconds);
    recordMeetingProvisionOutcome(provider, 'success');

    await emitMeetingAuditEvent({
      action: 'MEETING_PROVISION_SUCCEEDED',
      incidentId,
      provider,
      generation: gen,
      metadata: { externalId: result.externalId },
    });

    // Check if close already won before or during adapter call
    const cachedBefore = memoryMeetingCache.get(incidentId);
    if (cachedBefore && (cachedBefore.state === 'CLOSED' || cachedBefore.state === 'CLOSING')) {
      return cachedBefore;
    }

    // Atomic CAS Update: Only transition to READY if state is still PROVISIONING and token matches.
    if (prisma?.incidentMeeting?.updateMany) {
      const updateResult = await prisma.incidentMeeting.updateMany({
        where: {
          incidentId,
          generation: gen,
          state: 'PROVISIONING',
          provisioningToken,
        },
        data: {
          state: 'READY',
          health: 'HEALTHY',
          externalId: result.externalId,
          joinUrl: result.joinUrl,
          joinWebUrl: result.joinWebUrl || null,
          conferenceId: result.conferenceId || null,
          tollNumber: result.tollNumber || null,
          organizerEmail: result.organizerEmail || null,
          providerMeetingId: result.providerMeetingId || null,
          readyAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      if (dbHasRecord && updateResult.count === 0) {
        // CLOSE won the race in DB, or token changed. Do NOT resurrect to READY!
        const latest = await getIncidentMeeting(incidentId);
        return (
          latest || {
            id: meetingId,
            incidentId,
            generation: gen,
            provider,
            state: 'CLOSED',
            health: 'HEALTHY',
            externalId: result.externalId,
            joinUrl: '',
            createdAt: now,
            closedAt: now,
            actions: { canJoin: false, canProvision: false, canRetry: false, canClose: false },
          }
        );
      }
    }

    const readyMeeting: IncidentMeetingView = {
      id: meetingId,
      incidentId,
      generation: gen,
      provider,
      state: 'READY',
      health: 'HEALTHY',
      externalId: result.externalId,
      joinUrl: result.joinUrl,
      joinWebUrl: result.joinWebUrl || null,
      conferenceId: result.conferenceId || null,
      tollNumber: result.tollNumber || null,
      organizerEmail: result.organizerEmail || null,
      providerMeetingId: result.providerMeetingId || null,
      createdAt: currentStatus?.createdAt || now,
      actions: {
        canJoin: true,
        canProvision: false,
        canRetry: false,
        canClose: true,
        supportsExternalClose: provider === 'MICROSOFT_TEAMS',
        closeLabel: provider === 'MICROSOFT_TEAMS' ? 'End Meeting' : 'Detach Bridge',
      },
    };

    memoryMeetingCache.set(incidentId, readyMeeting);

    // Reproject meeting link to active incident war rooms
    if (prisma?.incidentWarRoom?.findMany) {
      const activeRooms = await prisma.incidentWarRoom
        .findMany({
          where: { incidentId, state: { in: ['READY', 'CLOSING'] } },
          select: { id: true },
        })
        .catch(() => []);
      if (activeRooms.length > 0) {
        const { requestWarRoomProjectionNeutral } = await import('@/lib/war-room/engine');
        for (const r of activeRooms) {
          await requestWarRoomProjectionNeutral(r.id).catch(() => null);
        }
      }
    }

    return readyMeeting;
  } catch (error) {
    const durationSeconds = (performance.now() - startedAt) / 1000;
    observeMeetingProvisionDuration(provider, durationSeconds);
    const errorMessage = (error as Error).message || 'Failed to provision meeting bridge.';
    const isRetryable = isRetryableMeetingError(error);
    const hasMoreAttempts =
      params.attempt != null && params.maxAttempts != null && params.attempt < params.maxAttempts;

    if (isRetryable && hasMoreAttempts) {
      recordMeetingRetry(provider, 'provision', classifyRetryReason(error));
      if (prisma?.incidentMeeting?.updateMany) {
        await prisma.incidentMeeting
          .updateMany({
            where: {
              incidentId,
              generation: gen,
              state: 'PROVISIONING',
              provisioningToken,
            },
            data: {
              health: 'DEGRADED',
              lastErrorCode: 'PROVISION_RETRYABLE_ERROR',
              lastErrorMessage: errorMessage,
            },
          })
          .catch(() => null);
      }
      throw error;
    }

    recordMeetingProvisionOutcome(provider, 'failed');
    await emitMeetingAuditEvent({
      action: 'MEETING_PROVISION_FAILED',
      incidentId,
      provider,
      generation: gen,
      reason: errorMessage,
    });

    if (prisma?.incidentMeeting?.updateMany) {
      const updateResult = await prisma.incidentMeeting.updateMany({
        where: {
          incidentId,
          generation: gen,
          state: 'PROVISIONING',
          provisioningToken,
        },
        data: {
          state: 'FAILED',
          health: 'UNAVAILABLE',
          lastErrorCode: 'PROVISION_FAILED',
          lastErrorMessage: errorMessage,
        },
      });

      const mem = memoryMeetingCache.get(incidentId);
      if (mem && (mem.state === 'CLOSED' || mem.state === 'CLOSING')) {
        return mem;
      }

      if (dbHasRecord && updateResult.count === 0) {
        // CLOSE won the race
        const latest = await getIncidentMeeting(incidentId);
        return (
          latest || {
            id: meetingId,
            incidentId,
            generation: gen,
            provider,
            state: 'CLOSED',
            health: 'HEALTHY',
            externalId,
            joinUrl: '',
            createdAt: now,
            closedAt: now,
            actions: { canJoin: false, canProvision: false, canRetry: false, canClose: false },
          }
        );
      }
    }

    const failedMeeting: IncidentMeetingView = {
      id: meetingId,
      incidentId,
      generation: gen,
      provider,
      state: 'FAILED',
      health: 'UNAVAILABLE',
      externalId,
      joinUrl: '',
      createdAt: currentStatus?.createdAt || now,
      lastErrorCode: 'PROVISION_FAILED',
      lastErrorMessage: errorMessage,
      actions: {
        canJoin: false,
        canProvision: false,
        canRetry: true,
        canClose: false,
        supportsExternalClose: provider === 'MICROSOFT_TEAMS',
        closeLabel: provider === 'MICROSOFT_TEAMS' ? 'End Meeting' : 'Detach Bridge',
      },
    };

    memoryMeetingCache.set(incidentId, failedMeeting);
    return failedMeeting;
  }
}

/**
 * Atomic settlement of a meeting to CLOSED state in DB and cache.
 * Distinguishes normal close (CLOSING -> CLOSED) from cleanup repair (CLOSED + debt -> CLOSED + clean).
 */
export async function settleMeetingClosed(params: {
  meetingId?: string;
  incidentId: string;
  generation?: number;
  closeToken?: string | null;
  cleanupRepair?: boolean;
  provider?: IncidentMeetingProvider;
  errorData?: { lastErrorCode?: string | null; lastErrorMessage?: string | null };
}): Promise<void> {
  const {
    meetingId,
    incidentId,
    generation,
    closeToken,
    cleanupRepair = false,
    errorData,
  } = params;

  const current = await getIncidentMeeting(incidentId);
  const isDebt = Boolean(errorData?.lastErrorCode);
  const targetGen = generation ?? current?.generation ?? 1;
  const targetProvider = params.provider ?? current?.provider ?? 'NONE';

  if (cleanupRepair) {
    if (!isDebt) {
      // Successful cleanup repair: clear debt and restore HEALTHY state
      if (prisma?.incidentMeeting?.updateMany) {
        try {
          await prisma.incidentMeeting.updateMany({
            where: {
              ...(meetingId ? { id: meetingId } : { incidentId, generation: targetGen }),
              state: 'CLOSED',
              externalCleanupPending: true,
              ...(closeToken ? { closeToken } : {}),
            },
            data: {
              externalCleanupPending: false,
              health: 'HEALTHY',
              lastErrorCode: null,
              lastErrorMessage: null,
              lastReconciledAt: new Date(),
              closeToken: null,
            },
          });
        } catch (e) {
          if (process.env.NODE_ENV !== 'test' || process.env.VITEST_USE_REAL_DB === '1') {
            throw e;
          }
        }
      }

      if (current && current.generation === targetGen) {
        memoryMeetingCache.set(incidentId, {
          ...current,
          externalCleanupPending: false,
          health: 'HEALTHY',
          lastErrorCode: null,
          lastErrorMessage: null,
          closeToken: null,
        });
      }

      if (targetProvider !== 'NONE') {
        recordMeetingCloseOutcome(targetProvider, 'success');
        await emitMeetingAuditEvent({
          action: 'MEETING_CLEANUP_SUCCEEDED',
          incidentId,
          provider: targetProvider,
          generation: targetGen,
          reason: 'external_cleanup_repair_succeeded',
        });
      }
      return;
    } else {
      // Failed cleanup repair: persist failure error on existing debt row, degrade health, release closeToken
      if (prisma?.incidentMeeting?.updateMany) {
        try {
          await prisma.incidentMeeting.updateMany({
            where: {
              ...(meetingId ? { id: meetingId } : { incidentId, generation: targetGen }),
              state: 'CLOSED',
              externalCleanupPending: true,
              ...(closeToken ? { closeToken } : {}),
            },
            data: {
              health: 'DEGRADED',
              lastErrorCode: errorData?.lastErrorCode ?? 'PROVIDER_CLOSE_FAILED',
              lastErrorMessage: errorData?.lastErrorMessage ?? null,
              lastReconciledAt: new Date(),
              closeToken: null,
            },
          });
        } catch (e) {
          if (process.env.NODE_ENV !== 'test' || process.env.VITEST_USE_REAL_DB === '1') {
            throw e;
          }
        }
      }

      if (current && current.generation === targetGen) {
        memoryMeetingCache.set(incidentId, {
          ...current,
          health: 'DEGRADED',
          lastErrorCode: errorData?.lastErrorCode ?? 'PROVIDER_CLOSE_FAILED',
          lastErrorMessage: errorData?.lastErrorMessage ?? null,
          closeToken: null,
          externalCleanupPending: true,
        });
      }

      if (targetProvider !== 'NONE') {
        recordMeetingCloseOutcome(targetProvider, 'failed');
        await emitMeetingAuditEvent({
          action: 'MEETING_CLEANUP_FAILED',
          incidentId,
          provider: targetProvider,
          generation: targetGen,
          reason: errorData?.lastErrorMessage ?? 'PROVIDER_CLEANUP_FAILED',
        });
      }
      return;
    }
  }

  // Normal close settlement:
  const closedMeeting: IncidentMeetingView = {
    ...(current || {
      id: meetingId || `meet_${incidentId}_${targetGen}`,
      incidentId,
      generation: targetGen,
      provider: targetProvider,
      state: 'CLOSED',
      health: 'HEALTHY',
      externalId: `opsknight:${incidentId}:${targetGen}`,
      joinUrl: '',
      createdAt: new Date().toISOString(),
    }),
    state: 'CLOSED',
    health: isDebt ? 'DEGRADED' : 'HEALTHY',
    closedAt: new Date().toISOString(),
    externalCleanupPending: isDebt,
    closeToken: null,
    lastErrorCode: errorData?.lastErrorCode ?? null,
    lastErrorMessage: errorData?.lastErrorMessage ?? null,
    actions: {
      canJoin: false,
      canProvision: false,
      canRetry: false,
      canClose: false,
      supportsExternalClose: current?.actions.supportsExternalClose ?? false,
      closeLabel: current?.actions.closeLabel ?? 'Detach Bridge',
    },
  };

  if (prisma?.incidentMeeting?.updateMany) {
    try {
      await prisma.incidentMeeting.updateMany({
        where: {
          ...(meetingId ? { id: meetingId } : { incidentId, generation: targetGen }),
          state: closeToken ? 'CLOSING' : { in: ['CLOSING', 'READY', 'PROVISIONING', 'REQUESTED'] },
          ...(closeToken ? { closeToken } : {}),
        },
        data: {
          state: 'CLOSED',
          health: isDebt ? 'DEGRADED' : 'HEALTHY',
          closedAt: new Date(),
          externalCleanupPending: isDebt,
          provisioningToken: null,
          closeToken: null,
          lastErrorCode: errorData?.lastErrorCode ?? null,
          lastErrorMessage: errorData?.lastErrorMessage ?? null,
        },
      });
    } catch (e) {
      if (process.env.NODE_ENV !== 'test' || process.env.VITEST_USE_REAL_DB === '1') {
        throw e;
      }
    }
  }

  if (!current || current.generation === targetGen) {
    memoryMeetingCache.set(incidentId, closedMeeting);
  }

  if (targetProvider && targetProvider !== 'NONE') {
    if (isDebt) {
      recordMeetingCloseOutcome(targetProvider, 'failed');
      await emitMeetingAuditEvent({
        action: 'MEETING_CLOSE_FAILED',
        incidentId,
        provider: targetProvider,
        generation: targetGen,
        reason: errorData?.lastErrorMessage ?? 'PROVIDER_CLOSE_FAILED',
      });
    } else {
      recordMeetingCloseOutcome(targetProvider, 'success');
      await emitMeetingAuditEvent({
        action: 'MEETING_CLOSE_SUCCEEDED',
        incidentId,
        provider: targetProvider,
        generation: targetGen,
      });
    }
  }
}

/**
 * Close an active incident meeting.
 * For providers with external termination (e.g. Teams), transitions state to CLOSING
 * and delegates external Graph DELETE to the durable MEETING_CLOSE background job lane.
 * For static-link providers (Zoom, Meet, Jitsi), settles directly to CLOSED without external traffic.
 */
export async function closeIncidentMeeting(incidentId: string): Promise<void> {
  const current = await getIncidentMeeting(incidentId);
  if (!current || current.state === 'CLOSED' || current.state === 'CLOSING') return;

  const targetGen = current.generation;
  const targetMeetingId = current.id;
  const closeToken = crypto.randomUUID();

  // If provider adapter supports external termination, atomically transition to CLOSING and enqueue durable background job
  if (
    current.provider &&
    current.provider !== 'NONE' &&
    current.actions.supportsExternalClose &&
    current.providerMeetingId
  ) {
    let claimedByThisTx = false;

    if (prisma?.$transaction && prisma?.incidentMeeting && prisma?.backgroundJob) {
      try {
        await prisma.$transaction(async tx => {
          const updateResult = await tx.incidentMeeting.updateMany({
            where: {
              incidentId,
              generation: targetGen,
              state: { in: ['READY', 'PROVISIONING', 'REQUESTED'] },
            },
            data: {
              state: 'CLOSING',
              closeStartedAt: new Date(),
              closeToken,
            },
          });

          if (updateResult.count === 0) {
            // Another concurrent request won the claim or meeting is no longer closeable
            return;
          }

          claimedByThisTx = true;

          await tx.backgroundJob.create({
            data: {
              type: 'MEETING_CLOSE',
              status: 'PENDING',
              scheduledAt: new Date(),
              maxAttempts: 5,
              payload: {
                meetingId: targetMeetingId,
                incidentId,
                generation: targetGen,
                closeToken,
                cleanupRepair: false,
                provider: current.provider,
                providerMeetingId: current.providerMeetingId,
                organizerEmail: current.organizerEmail || null,
              },
            },
          });
        });
      } catch (err) {
        if (process.env.NODE_ENV !== 'test' || process.env.VITEST_USE_REAL_DB === '1') {
          throw err;
        }
      }
    } else {
      // Mock / fallback environment without transaction support
      claimedByThisTx = true;
    }

    if (!claimedByThisTx) {
      return;
    }

    await emitMeetingAuditEvent({
      action: 'MEETING_CLOSE_REQUESTED',
      incidentId,
      provider: current.provider,
      generation: targetGen,
    });

    const closingMeeting: IncidentMeetingView = {
      ...current,
      state: 'CLOSING',
      closeToken,
      closeStartedAt: new Date().toISOString(),
      actions: {
        ...current.actions,
        canJoin: false,
        canClose: false,
        canRetry: false,
        canProvision: false,
      },
    };
    memoryMeetingCache.set(incidentId, closingMeeting);

    // In unit test environment without a real DB and without a running worker daemon, execute synchronously
    if (process.env.NODE_ENV === 'test' && process.env.VITEST_USE_REAL_DB !== '1') {
      await executeMeetingCloseJob({
        meetingId: targetMeetingId,
        incidentId,
        generation: targetGen,
        closeToken,
        cleanupRepair: false,
        provider: current.provider,
        providerMeetingId: current.providerMeetingId,
        organizerEmail: current.organizerEmail || null,
      });
    }

    return;
  }

  // Static bridge providers (Zoom, Meet, Jitsi) or meetings without external lifecycle:
  // Immediately settle locally to CLOSED without background job or external provider calls.
  await settleMeetingClosed({
    meetingId: targetMeetingId,
    incidentId,
    generation: targetGen,
    cleanupRepair: false,
    provider: current.provider,
  });
}

/**
 * Background worker execution for durable MEETING_CLOSE jobs.
 * Only the worker executes the external provider deletion.
 * Classifies outcomes:
 * - 204 / 404: success -> settles to CLOSED
 * - 429 / 5xx / network: throws WarRoomRetryableError -> queue reschedules with backoff
 * - terminal (401/403): settles to CLOSED with PROVIDER_CLOSE_FAILED error metadata
 */
export async function executeMeetingCloseJob(params: {
  meetingId?: string;
  incidentId: string;
  generation?: number;
  closeToken?: string | null;
  cleanupRepair?: boolean;
  provider: IncidentMeetingProvider;
  providerMeetingId?: string | null;
  organizerEmail?: string | null;
}): Promise<{ status: 'COMPLETED' | 'STALE' | 'RETRYABLE' | 'FAILED' }> {
  const {
    meetingId,
    incidentId,
    generation,
    closeToken,
    cleanupRepair = false,
    provider,
    providerMeetingId,
    organizerEmail,
  } = params;

  if (!providerMeetingId || provider === 'NONE') {
    await settleMeetingClosed({
      meetingId,
      incidentId,
      generation,
      closeToken,
      cleanupRepair,
      provider,
    });
    return { status: 'COMPLETED' };
  }

  // Invariant I3: Stale jobs may never mutate a newer generation.
  // Validate exact meeting generation and closeToken ownership before performing external provider operations.
  let record: {
    id: string;
    generation: number;
    state: string;
    closeToken: string | null;
    externalCleanupPending: boolean;
  } | null = null;

  if (prisma?.incidentMeeting?.findFirst) {
    try {
      if (generation) {
        record = await prisma.incidentMeeting.findUnique({
          where: { incidentId_generation: { incidentId, generation } },
        });
      } else if (providerMeetingId) {
        // Safe rolling deployment: resolve by immutable providerMeetingId rather than latest generation
        record = await prisma.incidentMeeting.findFirst({
          where: { incidentId, providerMeetingId },
        });
      }

      if (!record) {
        await emitMeetingAuditEvent({
          action: 'MEETING_CLOSE_STALE_DROPPED',
          incidentId,
          provider,
          generation: generation ?? 0,
          reason: 'meeting_record_not_found_or_legacy_mismatch',
        });
        return { status: 'STALE' };
      }

      if (cleanupRepair) {
        if (
          record.state !== 'CLOSED' ||
          !record.externalCleanupPending ||
          (closeToken && record.closeToken && record.closeToken !== closeToken)
        ) {
          await emitMeetingAuditEvent({
            action: 'MEETING_CLOSE_STALE_DROPPED',
            incidentId,
            provider,
            generation: record.generation,
            reason: 'cleanup_repair_ownership_mismatch',
          });
          return { status: 'STALE' };
        }
      } else {
        if (
          record.state !== 'CLOSING' ||
          (closeToken && record.closeToken && record.closeToken !== closeToken)
        ) {
          await emitMeetingAuditEvent({
            action: 'MEETING_CLOSE_STALE_DROPPED',
            incidentId,
            provider,
            generation: record.generation,
            reason: 'close_token_or_state_mismatch',
          });
          return { status: 'STALE' };
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'test' || process.env.VITEST_USE_REAL_DB === '1') {
        throw e;
      }
    }
  }

  const targetMeetingId = meetingId ?? record?.id;
  const targetGeneration = generation ?? record?.generation;

  const started = performance.now();
  try {
    await MeetingProviderRegistry.closeMeeting(provider, {
      providerMeetingId,
      organizerEmail,
    });
    const durationSeconds = (performance.now() - started) / 1000;
    observeMeetingCloseDuration(provider, durationSeconds);
    await settleMeetingClosed({
      meetingId: targetMeetingId,
      incidentId,
      generation: targetGeneration,
      closeToken,
      cleanupRepair,
      provider,
    });
    return { status: 'COMPLETED' };
  } catch (err) {
    const durationSeconds = (performance.now() - started) / 1000;
    observeMeetingCloseDuration(provider, durationSeconds);

    if (err instanceof WarRoomRetryableError) {
      // 429 or 5xx or network: bubble up to queue retry machinery
      throw err;
    }

    // Terminal failure (401/403 or non-retryable): settle to CLOSED with PROVIDER_CLOSE_FAILED error
    const errorMessage = err instanceof Error ? err.message : 'External meeting close failed';
    await settleMeetingClosed({
      meetingId: targetMeetingId,
      incidentId,
      generation: targetGeneration,
      closeToken,
      cleanupRepair,
      provider,
      errorData: {
        lastErrorCode: 'PROVIDER_CLOSE_FAILED',
        lastErrorMessage: errorMessage,
      },
    });

    return { status: 'FAILED' };
  }
}

/**
 * Settles an incident meeting to CLOSED when background close retries are exhausted,
 * capturing explicit provider cleanup debt on the record.
 */
export async function settleMeetingCloseFailure(
  incidentId: string,
  error: string,
  options?: {
    meetingId?: string;
    generation?: number;
    closeToken?: string;
    cleanupRepair?: boolean;
  }
): Promise<void> {
  await settleMeetingClosed({
    incidentId,
    meetingId: options?.meetingId,
    generation: options?.generation,
    closeToken: options?.closeToken,
    cleanupRepair: options?.cleanupRepair ?? false,
    errorData: {
      lastErrorCode: 'PROVIDER_CLOSE_FAILED',
      lastErrorMessage: `External meeting cleanup failed: ${error.slice(0, 300)}`,
    },
  });
}

/**
 * Automatically provision incident meeting bridge when autoCreate is enabled by policy.
 * Symmetrically invoked by TRIGGER_WAR_ROOM event side-effect alongside chat room creation.
 */
export async function maybeAutoProvisionIncidentMeeting(incidentId: string): Promise<void> {
  if (!prisma?.incident?.findUnique) return;

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          autoCreateWarRoom: true,
          warRoomVideoBridge: true,
          warRoomCustomBridgeUrl: true,
        },
      },
    },
  });

  if (!incident || !['OPEN', 'ACKNOWLEDGED'].includes(incident.status)) return;

  const existing = await getIncidentMeeting(incidentId);
  if (existing && ['READY', 'PROVISIONING', 'REQUESTED'].includes(existing.state)) {
    return; // Already active or provisioning
  }

  const {
    getGlobalWarRoomPolicy,
    getServiceWarRoomPolicy,
    resolveEffectiveMeetingProvider,
    shouldAutoCreateCollaboration,
  } = await import('./policy');

  const [globalPolicy, servicePolicy, teamsConfig] = await Promise.all([
    getGlobalWarRoomPolicy(),
    incident.serviceId ? getServiceWarRoomPolicy(incident.serviceId) : null,
    prisma.microsoftTeamsConfig?.findUnique
      ? prisma.microsoftTeamsConfig.findUnique({
          where: { id: 'default' },
          select: { enabled: true },
        })
      : Promise.resolve(null),
  ]);

  const serviceAutoCreate =
    servicePolicy?.autoCreate ?? incident.service?.autoCreateWarRoom ?? false;
  const autoCreate = shouldAutoCreateCollaboration({
    serviceAutoCreate,
    incidentUrgency: incident.urgency,
    incidentPriority: incident.priority,
    autoCreateOnUrgency: globalPolicy.autoCreateOnUrgency ?? ['HIGH'],
    autoCreateOnPriority: globalPolicy.autoCreateOnPriority ?? ['P1', 'P2'],
  });
  if (!autoCreate) return;

  const isTeamsMeetingAvailable = Boolean(teamsConfig?.enabled);

  const customTemplate = incident.service?.warRoomCustomBridgeUrl || null;

  const resolution = resolveEffectiveMeetingProvider({
    globalMeetingProvider: globalPolicy.defaultMeetingProvider,
    serviceMeetingProvider: servicePolicy?.meetingProvider ?? null,
    isTeamsMeetingAvailable,
    globalWarRoomsEnabled: globalPolicy.enabled,
    serviceWarRoomsEnabled: servicePolicy?.warRoomsEnabled ?? true,
  });

  if (resolution.isDisabled || resolution.effectiveProvider === 'NONE') {
    return;
  }

  await requestMeetingProvision({
    incidentId,
    provider: resolution.effectiveProvider,
    incidentTitle: incident.title,
    customTemplate,
  });
}
