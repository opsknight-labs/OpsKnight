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
    let timer;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Runtime query deadline reached.')),
            Math.max(1, deadline - now())
          );
        }),
      ]);
      report('Runtime database connection is ready.');
      return;
    } catch {
      // Do not print connection strings, driver messages or credentials.
      if (attempts === 1 || attempts % 10 === 0)
        report('Waiting for runtime database connectivity.');
    } finally {
      clearTimeout(timer);
    }
    if (now() >= deadline) break;
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
    // A blackholed backend may keep disconnect waiting on the outstanding probe.
    // Bound cleanup too; this is a short-lived startup process, never an app client.
    let timer;
    try {
      await Promise.race([
        prisma.$disconnect(),
        new Promise(resolve => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Runtime database readiness gate failed; refusing to start application processes.'
    );
    process.exit(1);
  });
module.exports = { waitForRuntimeDatabase };
