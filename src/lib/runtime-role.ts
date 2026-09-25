export const OPSKNIGHT_PROCESS_ROLES = [
  'integrated',
  'web',
  'scheduler',
  'worker',
  'general-worker',
  'critical-worker',
  'bulk-worker',
  'status-projector',
] as const;

export type OpsKnightProcessRole = (typeof OPSKNIGHT_PROCESS_ROLES)[number];

export interface RuntimeResponsibilities {
  startScheduler: boolean;
  startJobWorker: boolean;
  schedulerProfile: SchedulerProfile | null;
  workerLane: 'all' | 'general' | 'critical' | 'bulk' | 'projector' | null;
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
      };
    case 'web':
      return {
        startScheduler: false,
        startJobWorker: false,
        schedulerProfile: null,
        workerLane: null,
      };
    case 'scheduler':
      return {
        startScheduler: true,
        startJobWorker: false,
        schedulerProfile: getSchedulerProfile(schedulerProfileValue),
        workerLane: null,
      };
    case 'worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'all',
      };
    case 'general-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'general',
      };
    case 'critical-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'critical',
      };
    case 'bulk-worker':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'bulk',
      };
    case 'status-projector':
      return {
        startScheduler: false,
        startJobWorker: true,
        schedulerProfile: null,
        workerLane: 'projector',
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
