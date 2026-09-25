#!/usr/bin/env node
import { calculateRuntimeCapacity } from '../src/lib/runtime-capacity';

export { calculateRuntimeCapacity };

function main(): void {
  try {
    const analysis = calculateRuntimeCapacity(process.env);
    // eslint-disable-next-line no-console
    console.log(`\n=== OpsKnight Database Connection Budget Preflight ===`);
    // eslint-disable-next-line no-console
    console.log(`Topology Mode: ${analysis.mode} | PgBouncer: ${analysis.pgbouncer ? 'ENABLED' : 'DISABLED'}`);
    // eslint-disable-next-line no-console
    console.log(`Total Database Demand:      ${analysis.totalDemand} connections`);
    // eslint-disable-next-line no-console
    console.log(`Maximum Permitted Capacity: ${analysis.maxConnections} connections`);
    // eslint-disable-next-line no-console
    console.log(`Headroom / Safety Margin:   ${analysis.headroom} connections`);
    // eslint-disable-next-line no-console
    console.log(`\nBreakdown:`);
    // eslint-disable-next-line no-console
    console.log(`- Web Tier: ${JSON.stringify(analysis.breakdown.web)}`);
    if (analysis.breakdown.pgbouncer) {
      // eslint-disable-next-line no-console
      console.log(`- PgBouncer: ${JSON.stringify(analysis.breakdown.pgbouncer)}`);
    }
    if (analysis.mode === 'split') {
      // eslint-disable-next-line no-console
      console.log(`- Scheduler: ${JSON.stringify(analysis.breakdown.scheduler)}`);
      // eslint-disable-next-line no-console
      console.log(`- General Worker: ${JSON.stringify(analysis.breakdown.generalWorker)}`);
      // eslint-disable-next-line no-console
      console.log(`- Critical Worker: ${JSON.stringify(analysis.breakdown.criticalWorker)}`);
      // eslint-disable-next-line no-console
      console.log(`- Bulk Worker: ${JSON.stringify(analysis.breakdown.bulkWorker)}`);
      // eslint-disable-next-line no-console
      console.log(`- Status Projector: ${JSON.stringify(analysis.breakdown.statusProjector)}`);
      // eslint-disable-next-line no-console
      console.log(`- Direct Worker Total: ${analysis.directWorkerConnections} connections`);
    }

    if (!analysis.safe) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[FATAL CAPACITY MISMATCH] Demand (${analysis.totalDemand}) exceeds capacity (${analysis.maxConnections}) by ${Math.abs(analysis.headroom)} connections!`
      );
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log(`\n[OK] Database connection capacity budget validated successfully.\n`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`\n[FATAL CAPACITY ERROR] ${(err as Error).message}\n`);
    process.exit(1);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main();
} else if (process.argv[1] && process.argv[1].endsWith('validate-runtime-capacity.ts')) {
  main();
}
