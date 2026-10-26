/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS read-only fixture recovery tool. */
/* eslint-disable security/detect-non-literal-fs-filename -- Explicit CLI evidence and ledger paths in an owned local certification fixture. */
require('./isolated-runtime.cjs');
const fs = require('node:fs'),
  assert = require('node:assert/strict');
const prisma = require('../../src/lib/prisma').default;
(async () => {
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55445');
  assert.match(database.pathname, /^\/ingestion_test_http[_a-z0-9]*$/);
  const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  report.fixtureServiceId ||= process.argv[3];
  assert.equal(
    typeof report.fixtureServiceId,
    'string',
    'Fixture service identity required for reconciliation'
  );
  const ledger = fs
    .readFileSync(report.clientEvidence.ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(x => JSON.parse(x));
  assert.equal(report.clientEvidence.clientCountsMatch, true);
  for (const row of ledger) {
    assert.equal(row.kind, 'opsknight-ack');
    assert.equal(typeof row.receiptId, 'string');
    assert.equal(typeof row.deliveryId, 'string');
  }
  const ids = [...new Set(ledger.map(x => x.receiptId))];
  let matched = 0,
    completed = 0,
    wrongService = 0;
  for (let offset = 0; offset < ids.length; offset += 256) {
    const rows = await prisma.ingestionReceipt.findMany({
      where: { id: { in: ids.slice(offset, offset + 256) } },
      select: { id: true, status: true, serviceId: true },
    });
    matched += rows.length;
    completed += rows.filter(x => x.status === 'COMPLETED').length;
    if (report.fixtureServiceId)
      wrongService += rows.filter(x => x.serviceId !== report.fixtureServiceId).length;
  }
  assert.equal(matched, ids.length);
  assert.equal(completed, ids.length);
  assert.equal(wrongService, 0);
  console.log(
    JSON.stringify({
      report: process.argv[2],
      observedAt: new Date().toISOString(),
      acknowledgments: ledger.length,
      uniqueAcknowledgedReceiptIds: ids.length,
      matchedReceipts: matched,
      completedReceipts: completed,
      wrongService,
      passed: true,
      scope:
        'Read-only per-receipt reconciliation of retained client acknowledgment ledger in its owned fixture database; not external delivery proof.',
    })
  );
})()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
