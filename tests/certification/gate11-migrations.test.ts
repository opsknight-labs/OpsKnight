import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { certPrisma } from './helpers';

describe('Gate 11: Migration & Upgrade Certification', () => {
  it('certifies migration validity, health checks, and drift detection schema integrity', async () => {
    // 1. Run migration validation script
    const validateOutput = execSync('npm run prisma:validate', { encoding: 'utf-8' });
    expect(validateOutput).toContain('0 errors');

    // 2. Run migration health check script
    const healthOutput = execSync('npm run prisma:health', { encoding: 'utf-8' });
    expect(healthOutput).toContain('Migration health check passed!');

    // 3. Verify PostgreSQL schema has compliance drift tables and constraints
    const tableCheck = await certPrisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('ComplianceDriftBaseline', 'ComplianceDriftEvent', 'ComplianceMonitoringRun');
    `;
    expect(tableCheck).toHaveLength(3);

    // 4. Verify unique constraint / index on ComplianceDriftEvent
    const indexCheck = await certPrisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'ComplianceDriftEvent' AND indexname = 'ComplianceDriftEvent_activeDedupeKey_key';
    `;
    expect(indexCheck.length).toBeGreaterThanOrEqual(1);
  });
});
