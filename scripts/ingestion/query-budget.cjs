require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const {
  acceptPostgresEvent,
  prepareIngestionOrdering,
} = require('../../src/lib/ingestion/postgres');
const { consumeIngestionBatch } = require('../../src/lib/ingestion/worker');
const { compileAutomation } = require('../../src/lib/automation/compiler');
const { emptySnapshot } = require('../../src/lib/automation/contract');
const { checksum } = require('../../src/lib/automation/cache');

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/ingestion_test_query_budget');
  assert.equal(
    await prisma.ingestionReceipt.count({
      where: { status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
    }),
    0
  );
  await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`;
  const run = randomUUID();
  const service = await prisma.service.create({ data: { name: `Query budget ${run}` } });
  const actor = await prisma.user.create({
    data: {
      name: 'Query budget fixture',
      email: `${run}@example.test`,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: false },
    update: { automationEnabled: false },
  });
  await prepareIngestionOrdering();
  const snapshot = () => prisma.$queryRaw`
    /* ingestion_query_budget_snapshot */
    SELECT queryid::text AS id, calls::double precision AS calls,
      total_exec_time::double precision AS ms
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT LIKE '%ingestion_query_budget_snapshot%'
  `;
  const phases = [];
  async function measure(kind, stage, operation) {
    const before = new Map((await snapshot()).map(row => [row.id, row]));
    const started = performance.now();
    const result = await operation();
    const elapsedMs = performance.now() - started;
    const after = await snapshot();
    phases.push({
      kind,
      stage,
      elapsedMs,
      queryCalls: after.reduce((sum, row) => sum + row.calls - (before.get(row.id)?.calls || 0), 0),
      databaseExecutionMs: after.reduce(
        (sum, row) => sum + row.ms - (before.get(row.id)?.ms || 0),
        0
      ),
    });
    return result;
  }
  async function event(kind, action, key) {
    const accepted = await measure(kind, 'durable-admission', () =>
      acceptPostgresEvent(
        {
          serviceId: service.id,
          integrationId: 'query-budget',
          integrationType: 'WEBHOOK',
          receivedAt: new Date(),
          providerPayload: { fixture: true },
          event: {
            event_action: action,
            dedup_key: key,
            payload: { summary: 'Query budget fixture', severity: 'critical', source: 'fixture' },
          },
        },
        `${run}:${kind}`
      )
    );
    await measure(kind, 'claim-and-process', () => consumeIngestionBatch(1));
    assert.equal(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: accepted.receiptId } }))
        .status,
      'COMPLETED'
    );
  }
  await event('new-incident', 'trigger', run);
  await event('deduplicated-trigger', 'trigger', run);
  await event('acknowledge', 'acknowledge', run);
  await event('resolve', 'resolve', run);
  const source = {
    ...emptySnapshot,
    rules: [
      {
        id: 'no-page',
        name: 'Do not escalate',
        enabled: true,
        phase: 'ROUTE',
        conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'fixture' }],
        actions: [{ type: 'NO_ESCALATION' }],
      },
    ],
  };
  const { compiled, issues } = compileAutomation(source);
  assert.ok(!issues.some(issue => issue.level === 'ERROR'));
  const version = await prisma.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      snapshot: source,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      publishedBy: actor.id,
      lintReport: [],
    },
  });
  await prisma.serviceAutomationConfig.create({
    data: { serviceId: service.id, mode: 'LIVE', activeVersionId: version.id },
  });
  await prisma.systemSettings.update({
    where: { id: 'default' },
    data: { automationEnabled: true },
  });
  try {
    await event('automation-live-new-incident', 'trigger', `${run}-automation`);
  } finally {
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: false },
    });
  }
  assert.equal(await prisma.incident.count({ where: { serviceId: service.id } }), 2);
  assert.equal(await prisma.alert.count({ where: { serviceId: service.id } }), 5);
  assert.equal(
    await prisma.incidentAutomationDecision.count({ where: { serviceId: service.id } }),
    1
  );
  const evidence = {
    measuredAt: new Date().toISOString(),
    certified: false,
    sourceRevision: require('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim(),
    scope:
      'Sequential isolated library diagnostic; excludes HTTP/auth/quota/network and external delivery. Includes transaction control and claim SQL. No statement-statistics reset.',
    phases,
    accepted: 5,
    completed: 5,
    alerts: 5,
    incidents: 2,
    automationDecisions: 1,
  };
  writeFileSync(
    process.argv[2] || 'plans/event-ingestion/local-query-budget.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log(JSON.stringify(evidence, null, 2));
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
