const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForRuntimeDatabase } = require('../../scripts/wait-for-runtime-database.cjs');
test('waits for the runtime pooler instead of starting authentication against an unavailable endpoint', async () => {
  let clock = 0;
  let attempts = 0;
  const output = [];
  await waitForRuntimeDatabase(
    {
      $queryRaw: async () => {
        if (++attempts < 4) throw new Error('private connection failure');
      },
    },
    {
      timeoutMs: 100,
      pollMs: 10,
      now: () => clock,
      sleep: async delay => {
        clock += delay;
      },
      report: line => output.push(line),
    }
  );
  assert.equal(attempts, 4);
  assert.equal(clock, 30);
  assert.ok(output.includes('Runtime database connection is ready.'));
  assert.ok(!output.join('').includes('private'));
});
test('fails closed at the deadline without leaking driver messages', async () => {
  let clock = 0;
  const output = [];
  await assert.rejects(
    waitForRuntimeDatabase(
      {
        $queryRaw: async () => {
          throw new Error('postgres://secret@private-host');
        },
      },
      {
        timeoutMs: 25,
        pollMs: 10,
        now: () => clock,
        sleep: async delay => {
          clock += delay;
        },
        report: line => output.push(line),
      }
    ),
    /startup deadline/
  );
  assert.equal(clock, 25);
  assert.ok(!output.join('').includes('secret'));
  assert.ok(!output.join('').includes('private-host'));
});

test(
  'bounds a query that never resolves, including a blackholed backend',
  { timeout: 1000 },
  async () => {
    await assert.rejects(
      waitForRuntimeDatabase(
        { $queryRaw: () => new Promise(() => {}) },
        { timeoutMs: 25, report: () => undefined }
      ),
      /startup deadline/
    );
  }
);
