import validateScript from '../../scripts/validate-runtime-capacity.cjs';

export interface CapacityEnv {
  OPSKNIGHT_RUNTIME_MODE?: string;
  PGBOUNCER_ENABLED?: string;
  WEB_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
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

export const parseStrictPositiveInt: (
  key: string,
  val: string | undefined | null,
  fallback: number
) => number = validateScript.parseStrictPositiveInt;

export const parseStrictBoolean: (
  key: string,
  val: string | undefined | null,
  fallback?: boolean
) => boolean = validateScript.parseStrictBoolean;

export const loadDotenvIfPresent: (filePath?: string) => void =
  validateScript.loadDotenvIfPresent;

export const calculateRuntimeCapacity = validateScript.calculateRuntimeCapacity as (
  env?: CapacityEnv | Record<string, string | undefined>
) => CapacityAnalysisResult;
