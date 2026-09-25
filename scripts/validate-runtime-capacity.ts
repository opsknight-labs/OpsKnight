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
  DATABASE_POOL_SIZE_GENERAL_WORKER?: string;
  CRITICAL_WORKER_REPLICAS?: string;
  DATABASE_POOL_SIZE_CRITICAL_WORKER?: string;
  BULK_WORKER_REPLICAS?: string;
  DATABASE_POOL_SIZE_BULK_WORKER?: string;
  STATUS_PROJECTOR_REPLICAS?: string;
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

// Delegate implementation to commonjs module for dual ts/node compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { calculateRuntimeCapacity: cjsCalculate } = require('./validate-runtime-capacity.cjs');

export function calculateRuntimeCapacity(env?: Record<string, string | undefined>): CapacityAnalysisResult {
  return cjsCalculate(env || process.env);
}
