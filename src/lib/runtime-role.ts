import { resolveIngestionMode } from './ingestion/mode';

export const OPSKNIGHT_PROCESS_ROLES = [
  'integrated',
  'web',
  'http',
  'scheduler',
  'worker',
  'general-worker',
  'critical-worker',
  'bulk-worker',
  'status-projector',
  'runbook-worker',
  'ingestion-worker',
] as const;

export type OpsKnightProcessRole = (typeof OPSKNIGHT_PROCESS_ROLES)[number];

export interface RuntimeResponsibilities {
  startScheduler: boolean;
  startJobWorker: boolean;
  schedulerProfile: SchedulerProfile | null;
  workerLane: 'all' | 'general' | 'critical' | 'bulk' | 'projector' | 'runbook' | null;
  startIsolatedRunbookWorker: boolean;
}

export const OPSKNIGHT_SCHEDULER_PROFILES = ['full', 'maintenance'] as const;
export type SchedulerProfile = (typeof OPSKNIGHT_SCHEDULER_PROFILES)[number];

export interface SchedulerOwnership {
  backgroundJobs: boolean;
  escalations: boolean;
  notifications: boolean;
  statusProjection: boolean;
}

const DEFAULT_PROCESS_ROLE: OpsKnightProcessRole = 'integrated';

/**
 * Resolve the role for this process.
 *
 * The default preserves the single-process self-hosted runtime while also
 * running the durable job worker in-process. This keeps Docker Compose and
 * other integrated installs low-latency without requiring a separate worker
 * container, while split deployments can continue to isolate web, scheduler,
 * and worker responsibilities.
 */
export function getOpsKnightProcessRole(
  value: string | undefined = process.env.OPSKNIGHT_PROCESS_ROLE
): OpsKnightProcessRole {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_PROCESS_ROLE;

  if ((OPSKNIGHT_PROCESS_ROLES as readonly string[]).includes(normalized)) {
    return normalized as OpsKnightProcessRole;
  }

  throw new Error(
    `Invalid OPSKNIGHT_PROCESS_ROLE "${normalized}". Expected one of: ${OPSKNIGHT_PROCESS_ROLES.join(', ')}.`
  );
}

/**
 * Keep process-role policy in one place so startup code and tests cannot drift.
 */
export function getRuntimeResponsibilities(
  role: OpsKnightProcessRole,
  schedulerProfileValue: string | undefined = process.env.OPSKNIGHT_SCHEDULER_PROFILE
): RuntimeResponsibilities {
  switch (role) {
    case 'integrated':
      return {
        startScheduler: true,
        startJobWorker: true,
        schedulerProfile: 'full',
        workerLane: 'all',
        startIsolatedRunbookWorker: true,
      };
    case 'web':
    case 'http':
    case 'ingestion-worker':
      return {
        startScheduler: false,
        startJobWorker: false,
        schedulerProfile: null,
        workerLane: null,
        startIsolatedRunbookWorker: false,
      };
    case 'scheduler':
      return {
        startScheduler: true,
        startJobWorker: false,
        schedulerProfile: getSchedulerProfile(schedulerProfileValue),
        workerLane: null,
        startIsolatedRunbookWorker: false,
      };
    case 'worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'all',
        startIsolatedRunbookWorker: false,
      };
    case 'general-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'general',
        startIsolatedRunbookWorker: false,
      };
    case 'critical-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'critical',
        startIsolatedRunbookWorker: false,
      };
    case 'bulk-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'bulk',
        startIsolatedRunbookWorker: false,
      };
    case 'status-projector':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'projector',
        startIsolatedRunbookWorker: false,
      };
    case 'runbook-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'runbook',
        startIsolatedRunbookWorker: false,
      };
  }
}

/**
 * Dedicated scheduler processes keep their historical full profile unless an
 * operator explicitly opts into the split-runtime maintenance contract.
 */
export function getSchedulerProfile(
  value: string | undefined = process.env.OPSKNIGHT_SCHEDULER_PROFILE
): SchedulerProfile {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'full';
  if ((OPSKNIGHT_SCHEDULER_PROFILES as readonly string[]).includes(normalized)) {
    return normalized as SchedulerProfile;
  }
  throw new Error(
    `Invalid OPSKNIGHT_SCHEDULER_PROFILE "${normalized}". Expected one of: ${OPSKNIGHT_SCHEDULER_PROFILES.join(', ')}.`
  );
}

export function getSchedulerOwnership(profile: SchedulerProfile): SchedulerOwnership {
  const ownsWorkerLanes = profile === 'full';
  return {
    backgroundJobs: ownsWorkerLanes,
    escalations: ownsWorkerLanes,
    notifications: ownsWorkerLanes,
    statusProjection: ownsWorkerLanes,
  };
}

/** Bootstrap and readiness must agree on which processes own ingestion. */
export function shouldRunIngestionConsumer(
  role: OpsKnightProcessRole,
  mode = resolveIngestionMode(process.env.OPSKNIGHT_INGESTION_MODE)
): boolean {
  return (
    mode === 'postgres' && (role === 'integrated' || role === 'web' || role === 'ingestion-worker')
  );
}

/** Dedicated HTTP roles share authentication and pool policy. Only web owns
 * the compatibility ingestion fallback; http requires dedicated consumers. */
export function isDedicatedHttpRole(role: string): role is 'web' | 'http' {
  return role === 'web' || role === 'http';
}
