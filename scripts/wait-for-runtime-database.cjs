'use strict';

async function waitForRuntimeDatabase(
  prisma,
  {
    timeoutMs = 60_000,
    pollMs = 1000,
    now = Date.now,
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    report = message => console.log(message),
  } = {}
) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 1
  )
    throw new Error('Invalid runtime database readiness timeout.');
  const deadline = now() + timeoutMs;
  let attempts = 0;
  while (now() < deadline) {
    attempts++;
    try {
      await prisma.$queryRaw`SELECT 1`;
      report('Runtime database connection is ready.');
      return;
    } catch {
      // Do not print connection strings, driver messages or credentials.
      if (attempts === 1 || attempts % 10 === 0)
        report('Waiting for runtime database connectivity.');
    }
    await sleep(Math.min(pollMs, Math.max(1, deadline - now())));
  }
  throw new Error('Runtime database connection did not become ready before the startup deadline.');
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const raw =
    process.env.OPSKNIGHT_PROCESS_ROLE === 'web'
      ? process.env.WEB_DATABASE_URL || process.env.DATABASE_URL
      : process.env.DATABASE_URL;
  if (!raw) throw new Error('Runtime database configuration is required.');
  const url = new URL(raw);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('connect_timeout', '2');
  url.searchParams.set('pool_timeout', '2');
  url.searchParams.set('options', '-c statement_timeout=2000');
  const prisma = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  try {
    await waitForRuntimeDatabase(prisma, {
      timeoutMs: Number(process.env.OPSKNIGHT_RUNTIME_DATABASE_READY_TIMEOUT_MS || 60_000),
    });
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Runtime database readiness gate failed; refusing to start application processes.'
    );
    process.exitCode = 1;
  });
module.exports = { waitForRuntimeDatabase };
