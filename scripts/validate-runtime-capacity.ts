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
  mode: string;
  pgbouncer: boolean;
  webConnections: number;
  directWorkerConnections: number;
  totalDemand: number;
  maxConnections: number;
  safe: boolean;
  headroom: number;
  breakdown: Record<string, unknown>;
}

function parseNum(val: string | undefined | null, fallback: number): number {
  if (val === undefined || val === null || val === '') return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function parseBool(val: string | undefined | null, fallback = false): boolean {
  if (val === undefined || val === null || val === '') return fallback;
  const str = String(val).trim().toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
}

export function calculateRuntimeCapacity(
  env: CapacityEnv | Record<string, string | undefined> = process.env
): CapacityAnalysisResult {
  const mode = env.OPSKNIGHT_RUNTIME_MODE || 'split';
  const pgbouncer = parseBool(env.PGBOUNCER_ENABLED, false);

  const webReplicas = parseNum(env.WEB_REPLICAS, 1);
  const webPool = parseNum(env.DATABASE_POOL_SIZE_WEB, 10);

  const pgbouncerReplicas = parseNum(env.PGBOUNCER_REPLICAS, 1);
  const pgbouncerPool = parseNum(env.PGBOUNCER_DEFAULT_POOL_SIZE, 10);
  const pgbouncerReserve = parseNum(env.PGBOUNCER_RESERVE_POOL_SIZE, 5);

  const schedulerReplicas = parseNum(env.SCHEDULER_REPLICAS, 1);
  const schedulerPool = parseNum(env.DATABASE_POOL_SIZE_SCHEDULER, 3);

  const generalReplicas = parseNum(env.GENERAL_WORKER_REPLICAS || env.GENERAL_REPLICAS, 1);
  const generalPool = parseNum(env.DATABASE_POOL_SIZE_GENERAL_WORKER, 5);

  const criticalReplicas = parseNum(env.CRITICAL_WORKER_REPLICAS || env.CRITICAL_REPLICAS, 1);
  const criticalPool = parseNum(env.DATABASE_POOL_SIZE_CRITICAL_WORKER, 5);

  const bulkReplicas = parseNum(env.BULK_WORKER_REPLICAS || env.BULK_REPLICAS, 1);
  const bulkPool = parseNum(env.DATABASE_POOL_SIZE_BULK_WORKER, 3);

  const projectorReplicas = parseNum(env.STATUS_PROJECTOR_REPLICAS || env.PROJECTOR_REPLICAS, 1);
  const projectorPool = parseNum(env.DATABASE_POOL_SIZE_STATUS_PROJECTOR, 3);

  const maxConnections = parseNum(
    env.DATABASE_MAX_CONNECTIONS || env.DATABASE_MAX_APPLICATION_CONNECTIONS,
    80
  );

  let webConnections = 0;
  if (pgbouncer) {
    webConnections = pgbouncerReplicas * (pgbouncerPool + pgbouncerReserve);
  } else {
    webConnections = webReplicas * webPool;
  }

  const directWorkerConnections =
    schedulerReplicas * schedulerPool +
    generalReplicas * generalPool +
    criticalReplicas * criticalPool +
    bulkReplicas * bulkPool +
    projectorReplicas * projectorPool;

  const totalDemand = mode === 'integrated' ? webPool : webConnections + directWorkerConnections;
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
      pgbouncer: pgbouncer
        ? { replicas: pgbouncerReplicas, defaultPool: pgbouncerPool, reserve: pgbouncerReserve }
        : null,
      scheduler: {
        replicas: schedulerReplicas,
        pool: schedulerPool,
        total: schedulerReplicas * schedulerPool,
      },
      generalWorker: {
        replicas: generalReplicas,
        pool: generalPool,
        total: generalReplicas * generalPool,
      },
      criticalWorker: {
        replicas: criticalReplicas,
        pool: criticalPool,
        total: criticalReplicas * criticalPool,
      },
      bulkWorker: {
        replicas: bulkReplicas,
        pool: bulkPool,
        total: bulkReplicas * bulkPool,
      },
      statusProjector: {
        replicas: projectorReplicas,
        pool: projectorPool,
        total: projectorReplicas * projectorPool,
      },
    },
  };
}
