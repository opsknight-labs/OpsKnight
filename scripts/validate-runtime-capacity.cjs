#!/usr/bin/env node

/**
 * Universal Database Connection Budget Validator
 *
 * Validates connection budgets across Docker Compose, Helm, and Kustomize
 * deployments. Enforces that the total estimated database connection demand
 * (web pool/PgBouncer + worker lanes + scheduler) does not exceed the
 * configured max database capacity.
 */

function parseNum(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function parseBool(val, fallback = false) {
  if (val === undefined || val === null || val === '') return fallback;
  const str = String(val).trim().toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
}

function calculateRuntimeCapacity(env = process.env) {
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

  const maxConnections = parseNum(env.DATABASE_MAX_CONNECTIONS || env.DATABASE_MAX_APPLICATION_CONNECTIONS, 80);

  let webConnections = 0;
  if (pgbouncer) {
    webConnections = pgbouncerReplicas * (pgbouncerPool + pgbouncerReserve);
  } else {
    webConnections = webReplicas * webPool;
  }

  const directWorkerConnections =
    (schedulerReplicas * schedulerPool) +
    (generalReplicas * generalPool) +
    (criticalReplicas * criticalPool) +
    (bulkReplicas * bulkPool) +
    (projectorReplicas * projectorPool);

  const totalDemand = mode === 'integrated' ? webPool : (webConnections + directWorkerConnections);
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
      pgbouncer: pgbouncer ? { replicas: pgbouncerReplicas, defaultPool: pgbouncerPool, reserve: pgbouncerReserve } : null,
      scheduler: { replicas: schedulerReplicas, pool: schedulerPool, total: schedulerReplicas * schedulerPool },
      generalWorker: { replicas: generalReplicas, pool: generalPool, total: generalReplicas * generalPool },
      criticalWorker: { replicas: criticalReplicas, pool: criticalPool, total: criticalReplicas * criticalPool },
      bulkWorker: { replicas: bulkReplicas, pool: bulkPool, total: bulkReplicas * bulkPool },
      statusProjector: { replicas: projectorReplicas, pool: projectorPool, total: projectorReplicas * projectorPool },
    }
  };
}

if (require.main === module) {
  const result = calculateRuntimeCapacity(process.env);
  console.log('📊 OpsKnight Database Connection Budget Analysis:');
  console.log(`   - Runtime Mode: ${result.mode}`);
  console.log(`   - PgBouncer Pooling: ${result.pgbouncer ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   - Web Connection Demand: ${result.webConnections} (${result.pgbouncer ? 'via PgBouncer backends' : 'direct'})`);
  console.log(`   - Dedicated Direct Lanes Demand: ${result.directWorkerConnections}`);
  console.log(`   - Total Estimated Connection Demand: ${result.totalDemand}`);
  console.log(`   - Database Connection Capacity Limit: ${result.maxConnections}`);
  console.log(`   - Remaining Connection Headroom: ${result.headroom}`);

  if (!result.safe) {
    console.error(`❌ Unsafe Database Connection Budget: Total demand (${result.totalDemand}) exceeds capacity (${result.maxConnections}) by ${Math.abs(result.headroom)} connections!`);
    console.error('   Please reduce replica counts or pool sizes, or increase database capacity before starting.');
    process.exit(1);
  }

  console.log('✅ Connection budget is verified and within safe operating limits.');
  process.exit(0);
}

module.exports = { calculateRuntimeCapacity };
