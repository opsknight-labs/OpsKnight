/* eslint-disable security/detect-non-literal-fs-filename -- Paths are confined to a generated temporary fixture. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(url.pathname, '/enterprise_scim_test');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const stamp = randomBytes(6).toString('hex');
const schema = `scim_deploy_${stamp}`;
url.searchParams.set('schema', schema);
url.searchParams.set('connection_limit', '8');
const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const control = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const temp = mkdtempSync(join(tmpdir(), 'scim-deploy-'));
const schemaPath = join(temp, 'schema.prisma');
const migration = '20261023010000_user_canonical_email_reservation';
const event = `scim_pause_${stamp}`;
const lockKey = Number.parseInt(stamp.slice(0, 7), 16);
const children = new Set();
const pending = [];
function command(args) {
  const child = spawn('npx', ['prisma', ...args, '--schema', schemaPath], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  child.stdout.on('data', data => {
    output += data;
  });
  child.stderr.on('data', data => {
    output += data;
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      children.delete(child);
      resolve({ code, output });
    });
  });
}
async function prisma(args) {
  const result = await command(args);
  assert.equal(result.code, 0, result.output);
}
async function until(check, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}
async function migrateWithWriters(interrupt) {
  let release;
  let acquired;
  const ready = new Promise(resolve => {
    acquired = resolve;
  });
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const blocker = control.$transaction(
    async tx => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})::text`);
      acquired();
      await gate;
    },
    { timeout: 30000 }
  );
  pending.push(blocker);
  await ready;
  try {
    const deployment = command(['migrate', 'deploy']);
    pending.push(deployment);
    let pid;
    await until(async () => {
      const rows = await client.$queryRawUnsafe(`SELECT pid FROM pg_stat_activity
        WHERE wait_event = 'advisory'
        AND (query LIKE '%UserEmailReservation%' OR query LIKE '%CREATE TRIGGER user_canonical_email_reservation%')`);
      pid = rows[0]?.pid;
      return Boolean(pid);
    }, 'Prisma deployment did not reach the trigger-installation barrier');
    // Both operations must wait behind the migration's User write lock.
    const writers = [
      client.$executeRawUnsafe(
        `INSERT INTO "User" (id,email) VALUES ('writer-${interrupt}','writer-${interrupt}@example.test')`
      ),
      client.$executeRawUnsafe(
        `UPDATE "User" SET email='renamed-${interrupt}@example.test' WHERE id='rename-${interrupt}'`
      ),
    ].map(operation => Promise.resolve(operation));
    pending.push(...writers);
    await until(async () => {
      const rows = await client.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND query LIKE '%${interrupt}@example.test%'`);
      return rows[0].n === 2;
    }, 'Concurrent writers did not wait for the migration lock');
    if (interrupt) await client.$queryRaw`SELECT pg_terminate_backend(${pid}::integer)`;
    release();
    await blocker;
    const result = await deployment;
    if (interrupt) assert.notEqual(result.code, 0, 'Interrupted migration unexpectedly succeeded');
    else assert.equal(result.code, 0, result.output);
    await Promise.all(writers);
  } finally {
    release();
  }
}
try {
  await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  writeFileSync(
    schemaPath,
    `datasource db {
 provider = "postgresql"
 url = env("DATABASE_URL")
}
model User {
 id String @id
 email String @unique
}
`
  );
  mkdirSync(join(temp, 'migrations', '00000000000000_baseline'), { recursive: true });
  writeFileSync(join(temp, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  writeFileSync(
    join(temp, 'migrations', '00000000000000_baseline', 'migration.sql'),
    'CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);'
  );
  await prisma(['migrate', 'deploy']);
  await client.$executeRawUnsafe(`INSERT INTO "User" VALUES
    ('upper','Historical@example.test'),('lower','historical@example.test'),
    ('rename-true','old-true@example.test'),('rename-false','old-false@example.test')`);
  mkdirSync(join(temp, 'migrations', migration));
  // Copy the exact deployment artifact, without adding a test transaction.
  writeFileSync(
    join(temp, 'migrations', migration, 'migration.sql'),
    readFileSync(`prisma/migrations/${migration}/migration.sql`)
  );
  // Test-only DDL barrier pauses immediately before trigger installation. It
  // provides deterministic concurrent writers and interruption after backfill.
  await client.$executeRawUnsafe(`CREATE FUNCTION "${schema}".pause_install() RETURNS event_trigger
    LANGUAGE plpgsql AS $$ BEGIN IF current_schema() = '${schema}' THEN
    PERFORM pg_advisory_xact_lock(${lockKey}); END IF; END $$`);
  await client.$executeRawUnsafe(`CREATE EVENT TRIGGER "${event}" ON ddl_command_start
    WHEN TAG IN ('CREATE TRIGGER') EXECUTE FUNCTION "${schema}".pause_install()`);
  await migrateWithWriters(true);
  const rolledBack =
    await client.$queryRaw`SELECT to_regclass('"UserEmailReservation"')::text AS name`;
  assert.equal(rolledBack[0].name, null, 'Interrupted DDL/backfill did not roll back');
  await prisma(['migrate', 'resolve', '--rolled-back', migration]);
  await migrateWithWriters(false);
  const mismatch = await client.$queryRawUnsafe(`WITH actual AS (
    SELECT lower(email) AS email, count(*)::int AS n FROM "User" GROUP BY lower(email)
  ) SELECT * FROM actual FULL JOIN "UserEmailReservation" r ON r."canonicalEmail"=actual.email
    WHERE actual.n IS DISTINCT FROM r.holders`);
  assert.equal(mismatch.length, 0, 'Reservation counts differ from committed User rows');
  await assert.rejects(
    client.$executeRawUnsafe(`INSERT INTO "User" VALUES ('forbidden','HISTORICAL@example.test')`)
  );
  await prisma(['migrate', 'deploy']);
  console.log(
    JSON.stringify({
      prismaDeploy: 'passed',
      concurrentInsertAndRename: 'blocked then committed',
      interruption: 'DDL and backfill rolled back',
      resolveAndRetry: 'passed',
      reservationCounts: 'exact',
      historicalHolders: 2,
    })
  );
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.allSettled(pending);
  await client.$executeRawUnsafe(`DROP EVENT TRIGGER IF EXISTS "${event}"`);
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await Promise.all([client.$disconnect(), control.$disconnect()]);
  rmSync(temp, { recursive: true, force: true });
}
