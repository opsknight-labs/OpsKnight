// Run inside the candidate image against its isolated test PostgreSQL database.
// Loading native Prisma first reproduces the instrumentation/handler boundary.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
assert.ok(database.pathname.startsWith('/ingestion_test'));
assert.ok(['127.0.0.1', 'localhost', 'opsknight-ingestion-cert-db'].includes(database.hostname));
const { PrismaClient } = require('@prisma/client');
assert.equal(globalThis.prismaGlobal, undefined, 'Run this smoke check in a fresh Node process');
const client = new PrismaClient();
globalThis.prismaGlobal = client;
async function main() {
  require('/app/.next/server/app/api/integrations/uptimerobot/route.js');
  const webpack = require('/app/.next/server/webpack-runtime.js');
  const candidates = Object.entries(webpack.m).filter(([, factory]) =>
    factory.toString().includes('Shared ingestion quota unavailable')
  );
  assert.equal(candidates.length, 1, 'Cannot identify compiled quota module');
  const functions = Object.values(webpack(candidates[0][0])).filter(
    value => typeof value === 'function'
  );
  assert.equal(functions.length, 1, 'Compiled quota export changed; update smoke check explicitly');
  const result = await functions[0](`integration:image-prisma-smoke-${randomUUID()}`, 100, 60000);
  assert.equal(result.allowed, true);
  assert.ok(Number.isFinite(result.remaining));
  console.log(
    JSON.stringify({
      nativeClientBeforeCompiledRoute: true,
      nestedPrismaSqlExecuted: true,
      quotaAllowed: true,
    })
  );
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
