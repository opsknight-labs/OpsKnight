import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Retention Lifecycle Architecture Contracts', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('erasure execute module acquires retention resource lock and revalidates hold blockers', () => {
    const executePath = path.join(rootDir, 'src/lib/privacy/erasure/execute.ts');
    const content = fs.readFileSync(executePath, 'utf8');

    // Must import acquireRetentionResourceLock
    expect(content).toContain('acquireRetentionResourceLock');
    // Must acquire retention resource lock for USER
    expect(content).toMatch(
      /acquireRetentionResourceLock\s*\(\s*tx\s*,\s*['"]USER['"]\s*,\s*subjectId\s*\)/
    );
    // Must call discoverErasureBlockersTx inside transaction
    expect(content).toContain('discoverErasureBlockersTx');
  });

  it('erasure discover module checks retention holds as a review/blocking domain', () => {
    const discoverPath = path.join(rootDir, 'src/lib/privacy/erasure/discover.ts');
    const content = fs.readFileSync(discoverPath, 'utf8');

    expect(content).toContain('isRetentionHeld');
    expect(content).toMatch(
      /isRetentionHeld\s*\(\s*(?:prisma|tx|client)\s*,\s*['"]USER['"]\s*,\s*subjectId\s*\)/
    );
  });

  it('data cleanup module excludes held incidents and acquires advisory resource locks', () => {
    const cleanupPath = path.join(rootDir, 'src/lib/data-cleanup.ts');
    const content = fs.readFileSync(cleanupPath, 'utf8');

    // Must import and use hold filtering
    expect(content).toContain('filterHeldIncidents');
    expect(content).toContain('filterHeldPrivacyRequests');
    expect(content).toContain('getHeldIncidentIds');
    // Must acquire resource lock during batch incident deletion
    expect(content).toMatch(
      /acquireRetentionResourceLock\s*\(\s*tx\s*,\s*['"]INCIDENT['"]\s*,\s*incidentId\s*\)/
    );
  });

  it('retention holds service audits boolean flags without leaking raw reason text', () => {
    const holdsPath = path.join(rootDir, 'src/lib/retention/holds.ts');
    const content = fs.readFileSync(holdsPath, 'utf8');

    // Metadata in audit event must use reasonProvided
    expect(content).toContain('reasonProvided: true');
    expect(content).not.toMatch(/metadata:\s*\{[^}]*reason:\s*input\.reason/);
  });

  it('retention holds API enforces immutable compliance trail with no DELETE endpoint', () => {
    const holdsDir = path.join(rootDir, 'src/app/api/compliance/retention-holds');
    expect(fs.existsSync(holdsDir)).toBe(true);

    const checkNoDeleteMethod = (filePath: string) => {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/export\s+(?:async\s+)?function\s+DELETE/);
    };

    checkNoDeleteMethod(path.join(holdsDir, 'route.ts'));
    checkNoDeleteMethod(path.join(holdsDir, '[id]/route.ts'));
    checkNoDeleteMethod(path.join(holdsDir, '[id]/release/route.ts'));
  });

  it('retention settings schema and storage does not rely on new environment variables', () => {
    const envPath = path.join(rootDir, '.env.example');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    // No RETENTION_* env vars in example config
    expect(envContent).not.toMatch(/^RETENTION_/m);
  });

  it('all migrations adhere to 14-digit timestamp convention and split enum pattern', () => {
    const migrationsDir = path.join(rootDir, 'prisma/migrations');
    const entries = fs.readdirSync(migrationsDir).filter(f => !f.startsWith('.'));

    // Check 20260918000000 and 20260918000001
    const enumMigration = entries.find(e => e.includes('data_retention_hold_audit_type'));
    const foundationMigration = entries.find(e => e.includes('data_retention_hold_foundation'));

    expect(enumMigration).toBeDefined();
    expect(foundationMigration).toBeDefined();

    // 14-digit prefix
    expect(enumMigration).toMatch(/^\d{14}_/);
    expect(foundationMigration).toMatch(/^\d{14}_/);

    // Enum migration precedes foundation migration
    expect(enumMigration! < foundationMigration!).toBe(true);
  });
});
