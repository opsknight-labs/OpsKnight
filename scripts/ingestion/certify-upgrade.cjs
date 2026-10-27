/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS fixture loads the shared TypeScript runtime. */
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require -- Generated baseline client and schema live in the owned private temporary directory; paths are validated below. */
// Populated upgrade fixture. Never resets or reuses an existing database.
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { NextRequest } = require('next/server');

const root = process.cwd();
const baseline =
  process.env.INGESTION_UPGRADE_BASELINE || '58e9271cc7599447f86ecabae4592634d969cb30';
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Baseline must be a full commit hash');
if (process.env.OPSKNIGHT_INGESTION_MODE)
  throw new Error('Upgrade fixture requires no ingestion mode override');
const env = { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true' };
const temp = fs.mkdtempSync(path.join(root, '.ingestion-upgrade-'));
let old;
const current = new PrismaClient();
function run(command, args, extra = {}) {
  execFileSync(command, args, { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
}
function prisma(args) {
  run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), ...args]);
}

async function main() {
  const existing =
    await current.$queryRaw`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = current_schema()`;
  assert.equal(existing[0].count, 0, 'Use a newly created empty isolated database');
  const files = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', baseline, 'prisma/schema.prisma', 'prisma/migrations'],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n');
  for (const file of files) {
    if (!/^prisma\/[A-Za-z0-9_./-]+$/.test(file) || file.includes('..'))
      throw new Error('Invalid baseline path');
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, execFileSync('git', ['show', `${baseline}:${file}`]));
  }
  const schema = path.join(temp, 'prisma/schema.prisma');
  prisma(['migrate', 'deploy', '--schema', schema]);
  const client = path.join(temp, 'baseline-client');
  const original = fs.readFileSync(schema, 'utf8');
  assert.match(original, /generator client\s*\{[^}]*\}/);
  fs.writeFileSync(
    schema,
    original.replace(
      /generator client\s*\{[^}]*\}/,
      `generator client {\n provider = "prisma-client-js"\n output = ${JSON.stringify(client)}\n}`
    )
  );
  prisma(['generate', '--schema', schema]);
  const { PrismaClient: OldClient } = require(client);
  old = new OldClient();
  const suffix = randomUUID();
  const user = await old.user.create({
    data: {
      name: 'Existing administrator',
      email: `upgrade-${suffix}@example.test`,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await require('bcryptjs').hash('isolated-upgrade-fixture-only', 4),
    },
  });
  const service = await old.service.create({
    data: { name: `Existing service ${suffix}`, description: 'Preserve existing configuration' },
  });
  const integration = await old.integration.create({
    data: {
      name: 'Existing routing key',
      serviceId: service.id,
      type: 'EVENTS_API_V2',
      key: `fixture-${suffix}`,
      enabled: true,
    },
  });
  const incident = await old.incident.create({
    data: {
      serviceId: service.id,
      title: 'Existing incident',
      status: 'OPEN',
      dedupKey: `${integration.id}:existing`,
      slaAckTargetMs: 180000,
      slaResolveTargetMs: 900000,
    },
  });
  const alert = await old.alert.create({
    data: {
      serviceId: service.id,
      incidentId: incident.id,
      dedupKey: `${integration.id}:existing`,
      status: 'TRIGGERED',
      payload: { existing: true },
    },
  });
  const job = await old.backgroundJob.create({
    data: {
      type: 'NOTIFICATION',
      status: 'PENDING',
      scheduledAt: new Date(Date.now() + 86400000),
      payload: { existing: true },
    },
  });
  let automation = null;
  if (old.serviceAutomationConfig) {
    const snapshot = { schemaVersion: 1, fields: [], rules: [] };
    const version = await old.automationVersion.create({
      data: {
        serviceId: service.id,
        versionNumber: 1,
        snapshot,
        compiledSnapshot: snapshot,
        checksum: require('../../src/lib/automation/cache').checksum(snapshot),
        publishedBy: user.id,
        lintReport: [],
      },
    });
    automation = await old.serviceAutomationConfig.create({
      data: { serviceId: service.id, mode: 'LIVE', activeVersionId: version.id },
    });
  }
  async function snapshot() {
    return {
      user: await old.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, passwordHash: true, role: true, status: true },
      }),
      service: await old.service.findUnique({
        where: { id: service.id },
        select: { id: true, name: true, description: true },
      }),
      integration: await old.integration.findUnique({
        where: { id: integration.id },
        select: { id: true, key: true, enabled: true, serviceId: true, type: true },
      }),
      incident: await old.incident.findUnique({
        where: { id: incident.id },
        select: {
          id: true,
          title: true,
          status: true,
          slaAckTargetMs: true,
          slaResolveTargetMs: true,
        },
      }),
      alert: await old.alert.findUnique({ where: { id: alert.id } }),
      job: await old.backgroundJob.findUnique({ where: { id: job.id } }),
      automation: automation
        ? await old.serviceAutomationConfig.findUnique({ where: { serviceId: service.id } })
        : null,
    };
  }
  const before = await snapshot();
  // Execute the actual image migration/index/backfill entrypoint, then its split-runtime readiness gate.
  run('/bin/sh', ['docker-entrypoint.sh'], {
    OPSKNIGHT_MIGRATION_ONLY: 'true',
    OPSKNIGHT_SKIP_MIGRATIONS: 'false',
    SKIP_MIGRATIONS: 'false',
  });
  assert.deepEqual(await snapshot(), before, 'Image upgrade changed existing records');
  run(process.execPath, ['scripts/wait-for-database-ready.cjs'], {
    OPSKNIGHT_DATABASE_READY_TIMEOUT_MS: '5000',
    OPSKNIGHT_DATABASE_READY_POLL_MS: '100',
  });
  const { ingestionConfig } = require('../../src/lib/ingestion/config');
  assert.equal(ingestionConfig().mode, 'postgres');
  process.env.OPSKNIGHT_PROCESS_ROLE = 'web';
  const { startIngestionWorker, stopIngestionWorker } = require('../../src/lib/ingestion/worker');
  startIngestionWorker();
  assert.equal(await current.ingestionReceipt.count(), 0);
  assert.equal(await current.ingestionBudget.count(), 64);
  const { POST } = require('../../src/app/api/events/route');
  const receiptIds = [];
  async function send(action, large = false) {
    const response = await POST(
      new NextRequest('http://localhost/api/events', {
        method: 'POST',
        headers: {
          Authorization: `Token token=${integration.key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `upgrade-${action}-${suffix}`,
        },
        body: JSON.stringify({
          event_action: action,
          dedup_key: 'existing',
          payload: {
            summary: 'Existing client event',
            source: 'upgrade-test',
            severity: 'critical',
            custom_details: large ? { blob: 'x'.repeat(300000) } : { existing: true },
          },
        }),
      })
    );
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.data.status, 'success');
    assert.equal(body.data.result.action, 'accepted');
    const receiptId = body.data.result.receiptId;
    assert.equal(typeof receiptId, 'string');
    receiptIds.push(receiptId);
    const deadline = Date.now() + 15000;
    let receipt;
    do {
      receipt = await current.ingestionReceipt.findUniqueOrThrow({ where: { id: receiptId } });
      if (receipt.status === 'COMPLETED') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(receipt.status, 'COMPLETED');
    assert.equal(receipt.result.incidentId, incident.id);
    return receipt.result.action;
  }
  assert.equal(await send('trigger', true), 'deduplicated');
  assert.equal(await send('acknowledge'), 'acknowledged');
  assert.equal(await send('resolve'), 'resolved');
  assert.equal((await old.incident.findUnique({ where: { id: incident.id } })).status, 'RESOLVED');
  assert.equal(
    await current.ingestionReceipt.count(),
    3,
    'Plain image replacement must durably enqueue and process lifecycle work'
  );
  await stopIngestionWorker();
  assert.equal(receiptIds.length, 3);
  const oldWriter = await old.incident.create({
    data: { serviceId: service.id, title: 'Old client after upgrade' },
  });
  assert.equal(
    (await current.incident.findUnique({ where: { id: oldWriter.id } })).title,
    oldWriter.title
  );
  // A second startup must not recreate budgets or mutate existing routing and Automation config.
  run('/bin/sh', ['docker-entrypoint.sh'], {
    OPSKNIGHT_MIGRATION_ONLY: 'true',
    OPSKNIGHT_SKIP_MIGRATIONS: 'false',
    SKIP_MIGRATIONS: 'false',
  });
  assert.equal(await current.ingestionBudget.count(), 64);
  assert.equal(
    (await old.integration.findUnique({ where: { id: integration.id } })).key,
    integration.key
  );
  if (automation)
    assert.deepEqual(
      await old.serviceAutomationConfig.findUnique({ where: { serviceId: service.id } }),
      automation
    );
  const evidence = {
    measuredAt: new Date().toISOString(),
    baseline,
    runtime: process.version,
    scope:
      'Populated database upgrade using the actual image migration entrypoint and old/new Prisma clients; not a Docker image or HA rollout certification',
    existingDataPreserved: true,
    repeatedStartup: true,
    splitReadinessPassed: true,
    defaultMode: 'postgres',
    legacyApiActions: ['trigger', 'acknowledge', 'resolve'],
    legacyLargePayloadAccepted: true,
    deliveryIdempotencyEnabled: true,
    automaticWebFallbackProcessedReceipts: true,
    rollingMixedVersionUpgradeCertified: false,
    oldClientReadsAndWritesAfterUpgrade: true,
    existingAutomationConfigPreserved: automation ? true : 'absent in baseline',
    automaticQueueActivation: true,
    certifiedEnterprise: false,
  };
  fs.writeFileSync(
    path.join(root, `plans/event-ingestion/upgrade-auto-async-${baseline.slice(0, 8)}.json`),
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log('Populated image-startup upgrade compatibility passed.');
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await require('../../src/lib/ingestion/worker').stopIngestionWorker();
    await old?.$disconnect();
    await current.$disconnect();
    const shared = require('../../src/lib/prisma').default;
    await shared.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  });
