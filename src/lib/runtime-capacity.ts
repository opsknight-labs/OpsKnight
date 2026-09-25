export interface CapacityEnv {
  OPSKNIGHT_RUNTIME_MODE?: string;
  PGBOUNCER_ENABLED?: string;
  WEB_REPLICAS?: string;
  DATABASE_POOL_SIZE_WEB?: string;
  PGBOUNCER_REPLICAS?: string;
  PGBOUNCER_DEFAULT_POOL_SIZE?: string;
  PGBOUNCER_RESERVE_POOL_SIZE?: string;
  SCHEDULER_REPLICAS?: string;
  DATABASE_POOL_SIZE_SCHEDULER?: string;
  GENERAL_WORKER_REPLICAS?: string;
  GENERAL_REPLICAS?: string;
  DATABASE_POOL_SIZE_GENERAL_WORKER?: string;
  CRITICAL_WORKER_REPLICAS?: string;
  CRITICAL_REPLICAS?: string;
  DATABASE_POOL_SIZE_CRITICAL_WORKER?: string;
  BULK_WORKER_REPLICAS?: string;
  BULK_REPLICAS?: string;
  DATABASE_POOL_SIZE_BULK_WORKER?: string;
  STATUS_PROJECTOR_REPLICAS?: string;
  PROJECTOR_REPLICAS?: string;
  DATABASE_POOL_SIZE_STATUS_PROJECTOR?: string;
  DATABASE_MAX_CONNECTIONS?: string;
  DATABASE_MAX_APPLICATION_CONNECTIONS?: string;
}

export interface CapacityAnalysisResult {
  mode: 'integrated' | 'split';
  pgbouncer: boolean;
  webConnections: number;
  directWorkerConnections: number;
  totalDemand: number;
  maxConnections: number;
  safe: boolean;
  headroom: number;
  breakdown: {
    web: { replicas: number; pool: number; effective: number };
    pgbouncer: { replicas: number; defaultPool: number; reserve: number } | null;
    scheduler: { replicas: number; pool: number; total: number } | null;
    generalWorker: { replicas: number; pool: number; total: number } | null;
    criticalWorker: { replicas: number; pool: number; total: number } | null;
    bulkWorker: { replicas: number; pool: number; total: number } | null;
    statusProjector: { replicas: number; pool: number; total: number } | null;
  };
}

/**
 * Fail-closed parser for positive integer configuration values.
 * Rejects whitespace-padded garbage (e.g. '100foo'), negative numbers, or non-numeric tokens.
 */
export function parseStrictPositiveInt(
  key: string,
  val: string | undefined | null,
  fallback: number
): number {
  if (val === undefined || val === null || val === '') {
    return fallback;
  }
  const trimmed = String(val).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid capacity configuration for ${key}: "${val}" is not a valid non-negative integer`
    );
  }
  const n = parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(
      `Invalid capacity configuration for ${key}: "${val}" must be greater than 0`
    );
  }
  return n;
}

/**
 * Fail-closed boolean parser.
 * Requires explicit boolean strings ('true', 'false', '1', '0').
 */
export function parseStrictBoolean(
  key: string,
  val: string | undefined | null,
  fallback = false
): boolean {
  if (val === undefined || val === null || val === '') {
    return fallback;
  }
  const trimmed = String(val).trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') {
    return true;
  }
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
    return false;
  }
  throw new Error(
    `Invalid capacity configuration for ${key}: "${val}" is not a recognized boolean ('true' or 'false')`
  );
}

export function calculateRuntimeCapacity(
  env: CapacityEnv | Record<string, string | undefined> = process.env
): CapacityAnalysisResult {
  const rawMode = (env.OPSKNIGHT_RUNTIME_MODE || 'split').trim().toLowerCase();
  if (rawMode !== 'integrated' && rawMode !== 'split') {
    throw new Error(
      `Invalid OPSKNIGHT_RUNTIME_MODE: "${env.OPSKNIGHT_RUNTIME_MODE}". Must be "integrated" or "split".`
    );
  }
  const mode = rawMode as 'integrated' | 'split';
  const pgbouncer = parseStrictBoolean('PGBOUNCER_ENABLED', env.PGBOUNCER_ENABLED, false);

  if (mode === 'integrated' && pgbouncer) {
    throw new Error(
      'Invalid configuration: PgBouncer is only supported in "split" runtime mode.'
    );
  }

  const webReplicas = parseStrictPositiveInt('WEB_REPLICAS', env.WEB_REPLICAS, 1);
  const webPool = parseStrictPositiveInt('DATABASE_POOL_SIZE_WEB', env.DATABASE_POOL_SIZE_WEB, 10);

  const pgbouncerReplicas = parseStrictPositiveInt(
    'PGBOUNCER_REPLICAS',
    env.PGBOUNCER_REPLICAS,
    1
  );
  const pgbouncerPool = parseStrictPositiveInt(
    'PGBOUNCER_DEFAULT_POOL_SIZE',
    env.PGBOUNCER_DEFAULT_POOL_SIZE,
    10
  );
  const pgbouncerReserve = parseStrictPositiveInt(
    'PGBOUNCER_RESERVE_POOL_SIZE',
    env.PGBOUNCER_RESERVE_POOL_SIZE,
    5
  );

  const schedulerReplicas = parseStrictPositiveInt(
    'SCHEDULER_REPLICAS',
    env.SCHEDULER_REPLICAS,
    1
  );
  const schedulerPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_SCHEDULER',
    env.DATABASE_POOL_SIZE_SCHEDULER,
    3
  );

  const generalReplicas = parseStrictPositiveInt(
    'GENERAL_WORKER_REPLICAS',
    env.GENERAL_WORKER_REPLICAS || env.GENERAL_REPLICAS,
    1
  );
  const generalPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_GENERAL_WORKER',
    env.DATABASE_POOL_SIZE_GENERAL_WORKER,
    5
  );

  const criticalReplicas = parseStrictPositiveInt(
    'CRITICAL_WORKER_REPLICAS',
    env.CRITICAL_WORKER_REPLICAS || env.CRITICAL_REPLICAS,
    1
  );
  const criticalPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_CRITICAL_WORKER',
    env.DATABASE_POOL_SIZE_CRITICAL_WORKER,
    5
  );

  const bulkReplicas = parseStrictPositiveInt(
    'BULK_WORKER_REPLICAS',
    env.BULK_WORKER_REPLICAS || env.BULK_REPLICAS,
    1
  );
  const bulkPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_BULK_WORKER',
    env.DATABASE_POOL_SIZE_BULK_WORKER,
    3
  );

  const projectorReplicas = parseStrictPositiveInt(
    'STATUS_PROJECTOR_REPLICAS',
    env.STATUS_PROJECTOR_REPLICAS || env.PROJECTOR_REPLICAS,
    1
  );
  const projectorPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_STATUS_PROJECTOR',
    env.DATABASE_POOL_SIZE_STATUS_PROJECTOR,
    3
  );

  const maxConnections = parseStrictPositiveInt(
    'DATABASE_MAX_CONNECTIONS',
    env.DATABASE_MAX_CONNECTIONS || env.DATABASE_MAX_APPLICATION_CONNECTIONS,
    80
  );

  let webConnections = 0;
  if (mode === 'integrated') {
    // In integrated mode, each app replica runs web + background workers sharing its web connection pool
    webConnections = webReplicas * webPool;
  } else if (pgbouncer) {
    // In split mode with PgBouncer, web connects through PgBouncer pool
    webConnections = pgbouncerReplicas * (pgbouncerPool + pgbouncerReserve);
  } else {
    // In split mode without PgBouncer, web connects directly with its dedicated pool
    webConnections = webReplicas * webPool;
  }

  const directWorkerConnections =
    mode === 'integrated'
      ? 0
      : schedulerReplicas * schedulerPool +
        generalReplicas * generalPool +
        criticalReplicas * criticalPool +
        bulkReplicas * bulkPool +
        projectorReplicas * projectorPool;

  const totalDemand = webConnections + directWorkerConnections;
  const safe = totalDemand <= maxConnections;
  const headroom = maxConnections - totalDemand;

  return {
    mode,
    pgbouncer,
    webConnections,
    directWorkerConnections,
    totalDemand,
    maxConnections,
    safe,
    headroom,
    breakdown: {
      web: { replicas: webReplicas, pool: webPool, effective: webConnections },
      pgbouncer:
        pgbouncer && mode === 'split'
          ? { replicas: pgbouncerReplicas, defaultPool: pgbouncerPool, reserve: pgbouncerReserve }
          : null,
      scheduler:
        mode === 'split'
          ? {
              replicas: schedulerReplicas,
              pool: schedulerPool,
              total: schedulerReplicas * schedulerPool,
            }
          : null,
      generalWorker:
        mode === 'split'
          ? {
              replicas: generalReplicas,
              pool: generalPool,
              total: generalReplicas * generalPool,
            }
          : null,
      criticalWorker:
        mode === 'split'
          ? {
              replicas: criticalReplicas,
              pool: criticalPool,
              total: criticalReplicas * criticalPool,
            }
          : null,
      bulkWorker:
        mode === 'split'
          ? {
              replicas: bulkReplicas,
              pool: bulkPool,
              total: bulkReplicas * bulkPool,
            }
          : null,
      statusProjector:
        mode === 'split'
          ? {
              replicas: projectorReplicas,
              pool: projectorPool,
              total: projectorReplicas * projectorPool,
            }
          : null,
    },
  };
}
