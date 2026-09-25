#!/usr/bin/env node
'use strict';

const path = require('node:path');

// Register ts-node to execute the canonical TypeScript runtime capacity module
try {
  require('ts-node/register');
} catch {
  // If running in an environment with precompiled artifacts, require will resolve directly
}

let calculateRuntimeCapacity;
try {
  ({ calculateRuntimeCapacity } = require(path.join(__dirname, '../src/lib/runtime-capacity')));
} catch (err) {
  console.error(`\n[FATAL CAPACITY ERROR] Failed to load capacity module: ${err.message}\n`);
  process.exit(1);
}

function main() {
  try {
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

module.exports = { calculateRuntimeCapacity };
