/* eslint-disable security/detect-non-literal-fs-filename -- All file operations use paths beneath a private mkdtemp fixture. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const enabled = process.env.DB_SECRET_SCRIPTS_CERTIFICATION === '1';
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = enabled ? describe : describe.skip;
const key = 'auth.bootstrap.authorization';

// This suite launches real operator scripts and deletes its own fixtures. Require
// a dedicated database, never the application's configured database.
if (enabled && (!databaseUrl || new URL(databaseUrl).pathname !== '/pr847_test')) {
  throw new Error(
    'Database secret script certification requires the isolated pr847_test database.'
  );
}

describeDatabase('operator scripts with DATABASE_URL_FILE only', () => {
  let prisma: PrismaClient;
  let fixtureDir: string;
  let secretFile: string;

  function scriptEnv(extra: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of [
      'DATABASE_URL',
      'DIRECT_DATABASE_URL',
      'WEB_DATABASE_URL',
      'OPSKNIGHT_DATABASE_URL',
      'POSTGRES_PASSWORD',
    ]) {
      // eslint-disable-next-line security/detect-object-injection -- Fixed allowlist of database configuration variables.
      delete env[name];
      delete env[`${name}_FILE`];
    }
    return { ...env, NODE_ENV: 'production', DATABASE_URL_FILE: secretFile, ...extra };
  }

  async function script(name: string, args: string[] = [], extra: Partial<NodeJS.ProcessEnv> = {}) {
    try {
      const result = await run(process.execPath, [path.resolve('scripts', name), ...args], {
        env: scriptEnv(extra),
        timeout: 30_000,
      });
      return { ...result, code: 0 };
    } catch (error) {
      const result = error as Error & { stdout?: string; stderr?: string; code?: number };
      return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.code ?? 1 };
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'opsknight-secret-scripts-'));
    secretFile = path.join(fixtureDir, 'database-url');
    await writeFile(secretFile, `${databaseUrl}\r\n`, { mode: 0o600 });
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.systemConfig.deleteMany({ where: { key } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  });

  it('issues a capability, stores only its digest, and refuses to rotate a live capability', async () => {
    const first = await script('create-bootstrap-code.mjs');
    expect(first.code, first.stderr).toBe(0);
    const code = first.stdout.match(/^([A-Za-z0-9_-]{32})$/m)?.[1];
    expect(code).toBeTruthy();
    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key } });
    expect(row.value).toMatchObject({
      tokenHash: createHash('sha256').update(code!).digest('hex'),
      generation: 1,
      usedAt: null,
    });
    expect(JSON.stringify(row.value)).not.toContain(code!);
    const second = await script('create-bootstrap-code.mjs');
    expect(second.code).toBe(1);
    expect(second.stderr).toContain('A live bootstrap capability already exists');
    expect(second.stdout).not.toMatch(/^[A-Za-z0-9_-]{32}$/m);
  });

  it('creates and updates a CLI user, then refuses bootstrap on an initialized system', async () => {
    const args = [
      '--user',
      'Secret File Admin',
      '--email',
      'secret-file-admin@example.test',
      '--password',
      'isolated-test-password',
      '--role',
      'admin',
    ];
    const created = await script('OpsKnight.mjs', args);
    expect(created.code, created.stderr).toBe(0);
    expect(created.stdout).toContain('Created user');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'secret-file-admin@example.test' },
    });
    expect(user.role).toBe('ADMIN');
    expect(user.passwordHash).not.toBe('isolated-test-password');
    const duplicate = await script('OpsKnight.mjs', args);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('User already exists');
    const updated = await script('OpsKnight.mjs', [...args, '--update']);
    expect(updated.code, updated.stderr).toBe(0);
    const bootstrap = await script('create-bootstrap-code.mjs');
    expect(bootstrap.code).toBe(1);
    expect(bootstrap.stderr).toContain('already initialized');
    expect(await prisma.systemConfig.count({ where: { key } })).toBe(0);
  });

  it('fails safely for missing and malformed explicit secrets', async () => {
    for (const name of ['create-bootstrap-code.mjs', 'OpsKnight.mjs']) {
      const result = await script(name, [], {
        DATABASE_URL_FILE: path.join(fixtureDir, 'missing'),
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('DATABASE_URL_FILE');
      expect(result.stderr).not.toContain(databaseUrl!);
    }
    const badFile = path.join(fixtureDir, 'invalid');
    await writeFile(badFile, 'credential-that-must-not-be-logged');
    const invalid = await script('create-bootstrap-code.mjs', [], { DATABASE_URL_FILE: badFile });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('valid PostgreSQL connection URL');
    expect(invalid.stderr).not.toContain('credential-that-must-not-be-logged');
  });

  it('installs online indexes idempotently using a direct URL over an invalid pooled pointer', async () => {
    const extra = {
      DIRECT_DATABASE_URL: databaseUrl,
      DATABASE_URL_FILE: path.join(fixtureDir, 'missing-pool'),
    };
    for (const name of [
      'create-status-platform-online-indexes.cjs',
      'create-sla-scheduler-online-index.cjs',
      'create-voice-attempt-online-indexes.cjs',
    ]) {
      for (let pass = 0; pass < 2; pass += 1) {
        const result = await script(name, [], extra);
        expect(result.code, `${name}: ${result.stderr}`).toBe(0);
      }
    }
  }, 60_000);
  it('checks migration health and readiness through resolved secret/direct connections', async () => {
    const health = await script('check-migration-health.cjs');
    expect(health.code, health.stderr).toBe(0);
    const diagnostics = await script('prepare-authentication-diagnostics.cjs', [], {
      DATABASE_URL: databaseUrl,
    });
    expect(diagnostics.code, diagnostics.stderr).toBe(0);
    const readiness = await script('wait-for-database-ready.cjs', [], {
      DIRECT_DATABASE_URL: databaseUrl,
      DATABASE_URL_FILE: path.join(fixtureDir, 'missing-pool'),
      OPSKNIGHT_DATABASE_READY_TIMEOUT_MS: '2000',
      OPSKNIGHT_DATABASE_READY_POLL_MS: '50',
    });
    expect(readiness.code, readiness.stderr).toBe(0);
    expect(readiness.stdout).toContain('Database migrations and required online indexes are ready');
  });
});
