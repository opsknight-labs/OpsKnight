/* eslint-disable @typescript-eslint/no-require-imports -- Executable isolated diagnostic loads TypeScript through the shared fixture runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Explicit local fixture evidence destination. */
/* eslint-disable security/detect-object-injection -- Model keys come only from the fixed diagnostic model allowlist. */
const root = process.cwd();
require(root + '/scripts/ingestion/isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const db = require(root + '/src/lib/prisma').default;
const { processEvent } = require(root + '/src/lib/events');
const { claimPendingJobs, processJob } = require(root + '/src/lib/jobs/queue');
let current;
const models = [
  'BackgroundJob',
  'Incident',
  'Service',
  'SystemSettings',
  'User',
  'Integration',
  'IncidentWarRoom',
  'WarRoomProviderDelivery',
  'ServiceNotificationChannel',
  'Notification',
];
db.$on('query', q => {
  if (!current) return;
  current.queries++;
  current.driverQueryMs += q.duration;
  const model = models.find(m => q.query.includes('"' + m + '"')) || 'other';
  current.models[model] = (current.models[model] || 0) + 1;
});
(async () => {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/ingestion_test_side_effect_probe');
  assert.equal(await db.service.count(), 0);
  assert.equal(await db.integration.count(), 0);
  assert.equal(await db.user.count(), 0);
  const service = await db.service.create({ data: { name: 'Isolated side effect diagnostic' } });
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: false },
    update: { automationEnabled: false },
  });
  const repeats = [];
  for (let i = 0; i < 30; i++) {
    await processEvent(
      {
        event_action: 'trigger',
        dedup_key: randomUUID(),
        payload: { summary: 'Owned side effect profile', source: 'fixture', severity: 'critical' },
      },
      service.id,
      'fixture'
    );
    for (let round = 0; round < 5; round++) {
      const jobs = await claimPendingJobs(100, undefined, ['RUNBOOK']);
      if (!jobs.length) break;
      for (const job of jobs) {
        const effect = job.type === 'SCHEDULED_TASK' ? job.payload.effect : job.type;
        assert.ok(
          [
            'TRIGGER_WEBHOOK',
            'TRIGGER_ESCALATION_NOTIFICATIONS',
            'TRIGGER_SERVICE_NOTIFICATION',
            'TRIGGER_WAR_ROOM',
            'TRIGGER_STATUS_PAGE',
            'WAR_ROOM_PROVIDER_EVENT',
          ].includes(effect)
        );
        const row = { effect, iteration: i, queries: 0, driverQueryMs: 0, models: {} };
        const started = performance.now(),
          cpu = process.cpuUsage();
        current = row;
        try {
          row.success = await processJob(job);
        } finally {
          current = undefined;
          row.elapsedMs = performance.now() - started;
          const usage = process.cpuUsage(cpu);
          row.cpuMs = (usage.user + usage.system) / 1000;
          repeats.push(row);
        }
      }
    }
  }
  fs.writeFileSync(
    process.env.INGESTION_SIDE_EFFECT_PROFILE_EVIDENCE ||
      'plans/event-ingestion/local-side-effect-handler-profile-raw.json',
    JSON.stringify(
      {
        scope:
          'Sequential host-process handler diagnostic on an empty isolated migrated database with no integrations/users, no external providers, ordinary default settings and Automation off. Includes query driver durations; not native image capacity. First five iterations cold/warmup.',
        repeats,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ jobs: repeats.length, failed: repeats.filter(x => !x.success).length })
  );
})().finally(() => db.$disconnect());
