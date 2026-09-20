import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20260919000000_service_objective_foundation/migration.sql',
  'utf8'
);
const cronScheduler = readFileSync('src/lib/cron-scheduler.ts', 'utf8');

describe('service objective migration contract', () => {
  it('is additive and preserves legacy definition and snapshot tables', () => {
    expect(migration).toContain('CREATE TABLE "ServiceObjective"');
    expect(migration).toContain('CREATE TABLE "ServiceObjectiveSnapshot"');
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });

  it('does not reinterpret incident-only SLA definitions as objectives', () => {
    expect(migration).toContain('"targetAckTime" IS NULL');
    expect(migration).toContain('"targetResolveTime" IS NULL');
    expect(migration).toContain("WHEN \"metricType\" IN ('UPTIME', 'AVAILABILITY')");
    expect(migration).toContain("ELSE 'LESS_THAN_OR_EQUAL'");
  });

  it('reconstructs legacy lineages and enforces one active objective per scope and metric', () => {
    expect(migration).toContain(
      `COALESCE("serviceId", '__workspace__') || ':' || "metricType" || ':' || effective_chain_number`
    );
    expect(migration).toContain('WHEN "version" = 1 THEN 1');
    expect(migration).toContain('"ServiceObjective_one_active_service_metric_idx"');
    expect(migration).toContain('"ServiceObjective_one_active_workspace_metric_idx"');
    expect(migration).toContain('prevent_service_objective_revision_mutation');
  });

  it('repairs rollups before snapshots and retries partial snapshot failures', () => {
    expect(cronScheduler.indexOf('for (const day of dirtyDays)')).toBeLessThan(
      cronScheduler.indexOf('processServiceObjectiveSnapshots(now)')
    );
    expect(cronScheduler).toContain('serviceObjectiveSnapshots.failed > 0');
    expect(cronScheduler).toContain('retrying the daily run');
  });
});
