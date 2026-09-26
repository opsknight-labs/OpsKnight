#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads .env file into environment if present, without overwriting existing keys.
 */
function loadDotenvIfPresent(filePath) {
  const target = filePath || process.env.DOTENV_CONFIG_PATH || path.join(process.cwd(), '.env');
  if (fs.existsSync(target)) {
    try {
      const content = fs.readFileSync(target, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
        if (match) {
          const key = match[1];
          let val = match[2] || '';
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch {
      // Ignore reading errors if unreadable
    }
  }
}

/**
 * Fail-closed parser for positive integer configuration values.
 */
function parseStrictPositiveInt(key, val, fallback) {
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
 * Fail-closed parser for boolean configuration values.
 */
function parseStrictBoolean(key, val, fallback = false) {
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

/**
 * Validates database connection budget against configured limits.
 */
function calculateRuntimeCapacity(customEnv) {
  const env = customEnv || process.env;
  if (!customEnv || env === process.env) {
    loadDotenvIfPresent();
  }
  const rawMode = (env.OPSKNIGHT_RUNTIME_MODE || 'split').trim().toLowerCase();
  if (rawMode !== 'integrated' && rawMode !== 'split') {
    throw new Error(
      `Invalid capacity configuration for OPSKNIGHT_RUNTIME_MODE: "${env.OPSKNIGHT_RUNTIME_MODE}" is not recognized (must be "integrated" or "split")`
    );
  }
  const mode = rawMode;
  let pgbouncer = parseStrictBoolean('PGBOUNCER_ENABLED', env.PGBOUNCER_ENABLED, false);
  if (!pgbouncer && env.WEB_DATABASE_URL && env.WEB_DATABASE_URL.includes('pgbouncer=true')) {
    pgbouncer = true;
  }
  if (!pgbouncer && env.COMPOSE_FILE && env.COMPOSE_FILE.includes('docker-compose.pgbouncer.yml')) {
    pgbouncer = true;
  }
  if (!pgbouncer && env.SWARM_STACK_FILE && env.SWARM_STACK_FILE.includes('docker-stack.pgbouncer.yml')) {
    pgbouncer = true;
  }

  if (mode === 'integrated' && pgbouncer) {
    throw new Error(
      'Invalid capacity configuration: PgBouncer is only supported for split runtime mode. For integrated runtime, set PGBOUNCER_ENABLED=false.'
    );
  }

  const webReplicas = parseStrictPositiveInt(
    'WEB_REPLICAS',
    env.SWARM_REPLICAS_WEB || env.SWARM_WEB_REPLICAS || env.WEB_REPLICAS,
    1
  );
  const webPool = parseStrictPositiveInt('DATABASE_POOL_SIZE_WEB', env.DATABASE_POOL_SIZE_WEB, 10);

  const pgbouncerReplicas = parseStrictPositiveInt(
    'PGBOUNCER_REPLICAS',
    env.SWARM_REPLICAS_PGBOUNCER || env.SWARM_PGBOUNCER_REPLICAS || env.PGBOUNCER_REPLICAS,
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
    env.SWARM_REPLICAS_SCHEDULER || env.SWARM_SCHEDULER_REPLICAS || env.SCHEDULER_REPLICAS,
    1
  );
  const schedulerPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_SCHEDULER',
    env.DATABASE_POOL_SIZE_SCHEDULER,
    3
  );

  const generalReplicas = parseStrictPositiveInt(
    'GENERAL_WORKER_REPLICAS',
    env.SWARM_REPLICAS_GENERAL_WORKER ||
      env.SWARM_GENERAL_WORKER_REPLICAS ||
      env.GENERAL_WORKER_REPLICAS ||
      env.GENERAL_REPLICAS,
    1
  );
  const generalPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_GENERAL_WORKER',
    env.DATABASE_POOL_SIZE_GENERAL_WORKER,
    5
  );

  const criticalReplicas = parseStrictPositiveInt(
    'CRITICAL_WORKER_REPLICAS',
    env.SWARM_REPLICAS_CRITICAL_WORKER ||
      env.SWARM_CRITICAL_WORKER_REPLICAS ||
      env.CRITICAL_WORKER_REPLICAS ||
      env.CRITICAL_REPLICAS,
    1
  );
  const criticalPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_CRITICAL_WORKER',
    env.DATABASE_POOL_SIZE_CRITICAL_WORKER,
    5
  );

  const bulkReplicas = parseStrictPositiveInt(
    'BULK_WORKER_REPLICAS',
    env.SWARM_REPLICAS_BULK_WORKER ||
      env.SWARM_BULK_WORKER_REPLICAS ||
      env.BULK_WORKER_REPLICAS ||
      env.BULK_REPLICAS,
    1
  );
  const bulkPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_BULK_WORKER',
    env.DATABASE_POOL_SIZE_BULK_WORKER,
    3
  );

  const projectorReplicas = parseStrictPositiveInt(
    'STATUS_PROJECTOR_REPLICAS',
    env.SWARM_REPLICAS_STATUS_PROJECTOR ||
      env.SWARM_STATUS_PROJECTOR_REPLICAS ||
      env.STATUS_PROJECTOR_REPLICAS ||
      env.PROJECTOR_REPLICAS,
    1
  );
  const projectorPool = parseStrictPositiveInt(
    'DATABASE_POOL_SIZE_STATUS_PROJECTOR',
    env.DATABASE_POOL_SIZE_STATUS_PROJECTOR,
    3
  );

  const configuredMax =
    env.DATABASE_MAX_CONNECTIONS || env.DATABASE_MAX_APPLICATION_CONNECTIONS;
  const maxConnections = parseStrictPositiveInt('DATABASE_MAX_CONNECTIONS', configuredMax, 80);

  let webConnections = 0;
  if (mode === 'integrated') {
    webConnections = webReplicas * webPool;
  } else if (pgbouncer) {
    webConnections = pgbouncerReplicas * (pgbouncerPool + pgbouncerReserve);
  } else {
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

function main() {
  try {
    for (let i = 2; i < process.argv.length; i++) {
      if ((process.argv[i] === '--compose' || process.argv[i] === '-f') && process.argv[i + 1]) {
        const composePath = process.argv[i + 1];
        if (fs.existsSync(composePath)) {
          const content = fs.readFileSync(composePath, 'utf8');
          if (content.includes('opsknight-pgbouncer:')) {
            process.env.PGBOUNCER_ENABLED = 'true';
          }
        }
      }
    }
    const analysis = calculateRuntimeCapacity(process.env);
    console.log(`\n=== OpsKnight Database Connection Budget Preflight ===`);
    console.log(`Topology Mode: ${analysis.mode} | PgBouncer: ${analysis.pgbouncer ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Total Database Demand:      ${analysis.totalDemand} connections`);
    console.log(`Maximum Permitted Capacity: ${analysis.maxConnections} connections`);
    console.log(`Headroom / Safety Margin:   ${analysis.headroom} connections`);
    console.log(`\nBreakdown:`);
    console.log(`- Web Tier: ${JSON.stringify(analysis.breakdown.web)}`);
    if (analysis.breakdown.pgbouncer) {
      console.log(`- PgBouncer: ${JSON.stringify(analysis.breakdown.pgbouncer)}`);
    }
    if (analysis.mode === 'split') {
      console.log(`- Scheduler: ${JSON.stringify(analysis.breakdown.scheduler)}`);
      console.log(`- General Worker: ${JSON.stringify(analysis.breakdown.generalWorker)}`);
      console.log(`- Critical Worker: ${JSON.stringify(analysis.breakdown.criticalWorker)}`);
      console.log(`- Bulk Worker: ${JSON.stringify(analysis.breakdown.bulkWorker)}`);
      console.log(`- Status Projector: ${JSON.stringify(analysis.breakdown.statusProjector)}`);
      console.log(`- Direct Worker Total: ${analysis.directWorkerConnections} connections`);
    }

    if (!analysis.safe) {
      console.error(
        `\n[FATAL CAPACITY MISMATCH] Demand (${analysis.totalDemand}) exceeds capacity (${analysis.maxConnections}) by ${Math.abs(analysis.headroom)} connections!\n`
      );
      process.exit(1);
    }

    console.log(`\n[OK] Database connection capacity budget validated successfully.\n`);
  } catch (err) {
    console.error(`\n[FATAL CAPACITY ERROR] ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  calculateRuntimeCapacity,
  parseStrictPositiveInt,
  parseStrictBoolean,
  loadDotenvIfPresent,
};
