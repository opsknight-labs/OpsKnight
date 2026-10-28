/* eslint-disable @typescript-eslint/no-require-imports -- Owned local diagnostic uses the shared TypeScript runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Operator-selected local evidence destination. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const { acceptPostgresBatch } = require('../../src/lib/ingestion/batches');
const results = [];

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.port, '55445');
  assert.ok(url.pathname.startsWith('/ingestion_test_batch_profile'));
  assert.equal(await prisma.service.count(), 0);
  const service = await prisma.service.create({ data: { name: 'Owned atomic batch diagnostic' } });
  for (const count of [1, 32, 256, 1024, 10000]) {
    const integrationId = `batch-profile-${count}`;
    const events = Array.from({ length: count }, (_, index) => ({
      event_action: 'trigger',
      dedup_key: `batch-${count}-${index}`,
      payload: { summary: 'Owned batch', source: 'batch-profile', severity: 'critical' },
    }));
    const input = {
      serviceId: service.id,
      integrationId,
      integrationType: 'WEBHOOK',
      receivedAt: new Date(),
      providerPayload: { body: randomBytes(7500).toString('base64') },
    };
    const finish = await require('./database-profile.cjs')(prisma);
    let polling = false,
      partialVisible = false,
      samplingErrors = 0;
    const samples = [];
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const visible = await prisma.ingestionReceipt.count({
          where: { serviceId: service.id, integrationId },
        });
        samples.push(visible);
        if (visible > 0 && visible < count) partialVisible = true;
      } catch {
        samplingErrors++;
      } finally {
        polling = false;
      }
    };
    await poll();
    const timer = setInterval(() => {
      void poll();
    }, 10);
    const cpu = process.cpuUsage(),
      started = performance.now();
    let accepted = false;
    let errorCode;
    try {
      const values = await acceptPostgresBatch(
        input,
        events,
        events.map(() => randomUUID())
      );
      assert.equal(values.length, count);
      accepted = true;
    } catch (error) {
      // Keep only a recognized Prisma code, never messages, SQL or parameters.
      errorCode =
        typeof error?.code === 'string' && /^P[0-9]{4}$/.test(error.code)
          ? error.code
          : 'UNCLASSIFIED';
    } finally {
      clearInterval(timer);
      while (polling) await new Promise(resolve => setTimeout(resolve, 1));
    }
    const elapsedMs = performance.now() - started,
      usage = process.cpuUsage(cpu),
      databaseProfile = await finish();
    const persisted = await prisma.ingestionReceipt.count({
      where: { serviceId: service.id, integrationId },
    });
    const atomicityPreserved =
      !partialVisible && samplingErrors === 0 && (persisted === 0 || persisted === count);
    results.push({
      count,
      accepted,
      errorCode,
      persisted,
      elapsedMs,
      cpuMs: (usage.user + usage.system) / 1000,
      atomicityPreserved,
      samplingErrors,
      visibilitySampleCount: samples.length,
      databaseProfile,
    });
    assert.ok(atomicityPreserved, 'Batch exposed partial receipt visibility');
    if (!accepted) {
      process.exitCode = 1;
      break;
    }
  }
})()
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(async () => {
    writeFileSync(
      process.env.INGESTION_BATCH_PROFILE_EVIDENCE ||
        'plans/event-ingestion/local-batch-admission-profile.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          certifiedEnterprise: false,
          passed: results.length === 5 && results.every(result => result.accepted && result.atomicityPreserved),
          results,
          scope:
            'Owned host-library batch admission without HTTP or consumers. Includes10ms visibility-sampling overhead using the same bounded pool. Failure records are not batch capacity passes; all-or-nothing visibility and acknowledgments remain unchanged. No staged publication or prefix commits introduced.',
        },
        null,
        2
      ) + '\n'
    );
    await prisma.$disconnect();
  });
