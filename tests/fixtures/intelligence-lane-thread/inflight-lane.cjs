// A lane process for tests/integration/intelligence/lane-thread.test.ts whose Prisma client always has
// queries and an interactive transaction in flight. On `crash` it throws an uncaught error; it never
// answers `stop`, so the host must kill it with those queries still running. In a worker thread either
// ending aborted the whole process (the query engine calls back into the destroyed thread).
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const send = message => process.connected && process.send(message);
process.on('disconnect', () => process.exit(0));

for (let i = 0; i < 3; i += 1) prisma.$queryRawUnsafe('SELECT pg_sleep(5)::text').catch(() => {});
prisma
  .$transaction(async tx => tx.$queryRawUnsafe('SELECT pg_sleep(5)::text'), { timeout: 20_000 })
  .catch(() => {});
// The queries above are on the wire well before this.
setTimeout(() => send({ type: 'inflight', pid: process.pid }), 300);

process.on('message', message => {
  if (message && message.type === 'crash')
    setImmediate(() => {
      throw new Error('lane crashed with queries in flight');
    });
});
