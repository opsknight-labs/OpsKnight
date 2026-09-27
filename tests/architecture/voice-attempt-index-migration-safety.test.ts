import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('voice attempt index migration safety', () => {
  it('keeps CREATE INDEX CONCURRENTLY outside the transactional migration', () => {
    // PostgreSQL rejects CREATE INDEX CONCURRENTLY inside a transaction block.
    // Prisma wraps every migration file in an implicit transaction, so any CONCURRENTLY
    // statement in a migration.sql will fail immediately on prisma migrate deploy.
    //
    // The voice attempt indexes must be created by the out-of-band installer:
    //   scripts/create-voice-attempt-online-indexes.cjs
    // and this migration file must be a no-op (currently: SELECT 1).
    const migration = fs.readFileSync(
      'prisma/migrations/20260927120200_add_voice_attempt_indexes/migration.sql',
      'utf8'
    );
    const onlineInstaller = fs.readFileSync(
      'scripts/create-voice-attempt-online-indexes.cjs',
      'utf8'
    );

    // Migration must NOT contain an executable CONCURRENTLY statement.
    // Filter out comment lines before checking to avoid false positives from
    // explanatory comments that mention the prohibited pattern.
    const executableLines = migration
      .split('\n')
      .filter(line => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executableLines).not.toContain('CREATE INDEX CONCURRENTLY');

    // The installer must create both expected partial indexes outside the transaction.
    expect(onlineInstaller).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_attempt_open_voice"'
    );
    expect(onlineInstaller).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_attempt_provider_msg_id"'
    );
  });

  it('installer is registered in prisma:migrate:safe and all deployment paths', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const safeScript = packageJson.scripts['prisma:migrate:safe'] || '';
    const voiceScript = packageJson.scripts['prisma:indexes:voice-attempts'] || '';

    // prisma:migrate:safe must chain the voice installer
    expect(safeScript).toContain('prisma:indexes:voice-attempts');
    // The voice installer script must be registered
    expect(voiceScript).toContain('create-voice-attempt-online-indexes.cjs');

    // docker-entrypoint.sh must invoke the installer
    const entrypoint = fs.readFileSync('docker-entrypoint.sh', 'utf8');
    expect(entrypoint).toContain('create-voice-attempt-online-indexes.cjs');

    // Helm migration job must invoke the installer
    const helmJob = fs.readFileSync(
      'deploy/kubernetes/helm/opsknight/templates/migration-job.yaml',
      'utf8'
    );
    expect(helmJob).toContain('create-voice-attempt-online-indexes.cjs');
  });
});
