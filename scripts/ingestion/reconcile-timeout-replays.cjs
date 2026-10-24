/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS diagnostic loads production replay logic. */
/* eslint-disable security/detect-non-literal-fs-filename -- Evidence paths derive only from the fixed owned fixture allowlist. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const { replayPostgresEvents } = require('../../src/lib/ingestion/postgres');
const {
  decodeEnvelope,
  digest,
  IngestionRateLimitError,
} = require('../../src/lib/ingestion/contract');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.port, '55445');
  const fixtures = new Map([
    ['/ingestion_test_http_frontier_500', ['identity-frontier-500', '500']],
    ['/ingestion_test_http_frontier_1000', ['identity-frontier-1000', '1000']],
    ['/ingestion_test_http_general_two50', ['general-two-50', 'general-two-50']],
    [
      '/ingestion_test_http_job_completion50',
      ['job-completion-50-quiescent-ledger', 'job-completion-50'],
    ],
  ]);
  const fixture = fixtures.get(url.pathname);
  assert.ok(fixture, 'Replay diagnostic requires a fixed owned timeout fixture');
  const [sourceName, evidenceName] = fixture;
  const source = `plans/event-ingestion/local-docker-http-${sourceName}.json`;
  const prior = JSON.parse(readFileSync(source, 'utf8'));
  assert.ok(prior.ambiguousSubmissions > 0);
  const rows = await prisma.ingestionReceipt.findMany({
    where: { serviceId: prior.fixtureServiceId },
    select: { id: true, idempotencyKey: true, envelope: true, status: true },
    orderBy: { sequence: 'asc' },
  });
  assert.equal(rows.length, prior.accepted);
  const before = await prisma.ingestionReceipt.count({
    where: { serviceId: prior.fixtureServiceId },
  });
  for (let start = 0; start < rows.length; start += 128) {
    const group = rows.slice(start, start + 128);
    const inputs = group.map(row => {
      assert.equal(row.status, 'COMPLETED');
      const input = decodeEnvelope(row.envelope);
      const deliveryKey = `${input.integrationId}:${input.event.dedup_key}:0`;
      assert.equal(digest([input.serviceId, input.integrationId, deliveryKey]), row.idempotencyKey);
      return { input, deliveryKey };
    });
    const result = await replayPostgresEvents(
      inputs,
      new IngestionRateLimitError(Date.now() + 60000, 'events')
    );
    assert.deepEqual(
      result.map(item => item.receiptId),
      group.map(row => row.id)
    );
  }
  assert.equal(
    await prisma.ingestionReceipt.count({ where: { serviceId: prior.fixtureServiceId } }),
    before
  );
  const evidence = {
    measuredAt: new Date().toISOString(),
    passed: true,
    certified: false,
    source,
    recordedAmbiguousResponses: prior.ambiguousSubmissions,
    persistedReceiptsReplayed: rows.length,
    originalReceiptIdsRecovered: true,
    additionalReceipts: 0,
    scope:
      'Read-only production replay resolver against ALL persisted receipts from the historical timeout run, including its ambiguous subset. Original delivery identities reconstructed from owned k6 fixtures and checked against stored hashes. HTTP authentication is covered separately by native provider-replay checks. Does not identify individual timed-out requests or prove network-timeout prevention.',
  };
  writeFileSync(
    `plans/event-ingestion/local-timeout-replays-${evidenceName}.json`,
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log(JSON.stringify(evidence));
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
