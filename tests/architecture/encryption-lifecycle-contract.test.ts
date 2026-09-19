import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ENCRYPTION_TARGETS, computeRegistryFingerprint } from '@/lib/encryption/registry';

describe('Encryption Lifecycle Architecture Contracts', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('registry covers all known sensitive models and fields', () => {
    const targetIds = ENCRYPTION_TARGETS.map(t => t.id);

    // Essential targets
    expect(targetIds).toContain('oidc.client-secret');
    expect(targetIds).toContain('slack.bot-token');
    expect(targetIds).toContain('slack.signing-secret');
    expect(targetIds).toContain('slack-oauth.client-secret');
    expect(targetIds).toContain('slack-oauth.signing-secret');
    expect(targetIds).toContain('jira.api-token');
    expect(targetIds).toContain('jira.webhook-secret');
    expect(targetIds).toContain('teams.client-secret');
    expect(targetIds).toContain('integration.signature-secret');
    expect(targetIds).toContain('webhook.secret');
    expect(targetIds).toContain('status-page-webhook.secret');
    expect(targetIds).toContain('notification-provider.config');
    expect(targetIds).toContain('notification.payload-encrypted');
    expect(targetIds).toContain('notification-content.encrypted-template');
    expect(targetIds).toContain('chatops-intent.encrypted-payload');
    expect(targetIds).toContain('privacy-export.encrypted-payload');
    expect(targetIds).toContain('user-device.web-push-token');

    // Ensure all target definitions have required attributes
    for (const target of ENCRYPTION_TARGETS) {
      expect(target.id).toBeTruthy();
      expect(target.model).toBeTruthy();
      expect(target.field).toBeTruthy();
      expect(target.storageType).toBeTruthy();
      expect(typeof target.plaintextLegacyAllowed).toBe('boolean');
    }
  });

  it('computes deterministic registry fingerprint', () => {
    const fp1 = computeRegistryFingerprint(ENCRYPTION_TARGETS);
    const fp2 = computeRegistryFingerprint([...ENCRYPTION_TARGETS].reverse());

    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('decrypt in encryption.ts is a pure reader without uncoordinated async background DB mutations', () => {
    const encPath = path.join(rootDir, 'src/lib/encryption.ts');
    const content = fs.readFileSync(encPath, 'utf8');

    // Must not contain Promise.resolve().then(async () => ... updateMany in decrypt
    expect(content).not.toMatch(
      /Promise\.resolve\(\)\.then\(async\s*\(\)\s*=>[\s\S]*prisma\.oidcConfig\.updateMany/
    );
    expect(content).not.toMatch(/Dynamic on-the-fly migration error/);
  });

  it('key retirement assessment enforces verification against matching fingerprint', () => {
    const retirementPath = path.join(rootDir, 'src/lib/encryption/retirement.ts');
    const content = fs.readFileSync(retirementPath, 'utf8');

    // Must compare registryFingerprint
    expect(content).toContain('computeRegistryFingerprint');
    expect(content).toContain('registryFingerprint: currentFingerprint');
    expect(content).toContain("mode: 'VERIFY'");
    expect(content).toContain("status: 'COMPLETED'");
  });

  it('migration engine implements Compare-And-Swap (CAS) update pattern', () => {
    const migrationPath = path.join(rootDir, 'src/lib/encryption/migration.ts');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Must use updateMany with original value condition
    expect(content).toContain('updateMany');
    expect(content).toContain('conflictCount');
    expect(content).toContain('updateResult.count === 0');
  });

  it('auditing and issue tracking never log raw ciphertext or plaintext', () => {
    const migrationPath = path.join(rootDir, 'src/lib/encryption/migration.ts');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Issue recording should only store metadata
    expect(content).toContain('recordIssue');
    expect(content).not.toMatch(/recordIssue\([^)]*plaintext/i);
    expect(content).not.toMatch(/recordIssue\([^)]*ciphertext/i);
  });

  it('all migrations adhere to 14-digit timestamp convention and split enum pattern', () => {
    const migrationsDir = path.join(rootDir, 'prisma/migrations');
    const entries = fs.readdirSync(migrationsDir).filter(f => !f.startsWith('.'));

    const enumMigration = entries.find(e => e.includes('encryption_lifecycle_enums'));
    const foundationMigration = entries.find(e => e.includes('encryption_migration_foundation'));

    expect(enumMigration).toBeDefined();
    expect(foundationMigration).toBeDefined();

    expect(enumMigration).toMatch(/^\d{14}_/);
    expect(foundationMigration).toMatch(/^\d{14}_/);

    expect(enumMigration! < foundationMigration!).toBe(true);
  });
});
