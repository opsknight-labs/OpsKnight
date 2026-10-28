/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS certification helper. */
const assert = require('node:assert/strict');

// This is a post-load functional drain, separate from sampled backlog growth
// during load. Keep every worker running until all due jobs finish or timeout.
module.exports = async function downstreamDrain(prisma, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000);
  assert.ok(Number.isFinite(intervalMs) && intervalMs > 0 && intervalMs <= timeoutMs);
  const started = now();
  let consecutiveEmpty = 0;
  const samples = [];
  while (now() - started <= timeoutMs) {
    const rows = await prisma.$queryRaw`
      SELECT type, status, count(*)::int AS count,
        count(*) FILTER (WHERE "scheduledAt" <= clock_timestamp())::int AS due
      FROM "BackgroundJob"
      WHERE status IN ('PENDING', 'PROCESSING', 'PENDING_V2', 'PROCESSING_V2', 'FAILED')
      GROUP BY type, status ORDER BY type, status
    `;
    const due = rows.reduce((sum, row) => sum + row.due, 0);
    const failed = rows
      .filter(row => row.status === 'FAILED')
      .reduce((sum, row) => sum + row.count, 0);
    samples.push({ elapsedMs: now() - started, due, failed, jobs: rows });
    consecutiveEmpty = due === 0 && failed === 0 ? consecutiveEmpty + 1 : 0;
    if (consecutiveEmpty >= 2)
      return {
        passed: true,
        samples,
        timeoutMs,
        scope:
          'Two empty post-load due-job snapshots while consumers remain running. Includes all BackgroundJob families in owned fixture; not external delivery or long-term backlog proof.',
      };
    await sleep(intervalMs);
  }
  return {
    passed: false,
    samples,
    timeoutMs,
    scope: 'Post-load due/failed jobs did not clear before timeout; not a passing downstream gate.',
  };
};
