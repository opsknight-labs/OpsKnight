export const OPSKNIGHT_PROCESS_ROLES = ['integrated', 'web', 'scheduler', 'worker'] as const;

export type OpsKnightProcessRole = (typeof OPSKNIGHT_PROCESS_ROLES)[number];

export interface RuntimeResponsibilities {
  startScheduler: boolean;
  startJobWorker: boolean;
}

const DEFAULT_PROCESS_ROLE: OpsKnightProcessRole = 'integrated';

/**
 * Resolve the role for this process.
 *
 * The default deliberately preserves the pre-worker-plane runtime: every
 * application process starts the existing distributed cron scheduler. New
 * deployments can opt into separated web/scheduler/worker responsibilities
 * without forcing a flag-day migration on existing installations.
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
export function getRuntimeResponsibilities(role: OpsKnightProcessRole): RuntimeResponsibilities {
  switch (role) {
    case 'integrated':
      return { startScheduler: true, startJobWorker: false };
    case 'web':
      return { startScheduler: false, startJobWorker: false };
    case 'scheduler':
      return { startScheduler: true, startJobWorker: false };
    case 'worker':
      return { startScheduler: false, startJobWorker: true };
  }
}
