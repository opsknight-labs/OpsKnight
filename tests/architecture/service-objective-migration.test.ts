import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20260919000000_service_objective_foundation/migration.sql',
  'utf8'
);

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
});
