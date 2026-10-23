// Test-only child: stop after executing the real incident transaction, before COMMIT.
// Parent kills this process to verify PostgreSQL aborts all staged changes.
require('./isolated-runtime.cjs');
const prisma = require('../../src/lib/prisma').default;
const { processEvent } = require('../../src/lib/events');
const { claimPostgresEvents } = require('../../src/lib/ingestion/postgres');
const { decodeEnvelope } = require('../../src/lib/ingestion/contract');
(async () => {
  const [claim] = await claimPostgresEvents(1);
  if (!claim) throw new Error('No receipt to crash');
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (operation, options) =>
    transaction(async tx => {
      const result = await operation(tx);
      process.send({ staged: true, receiptId: claim.id });
      await new Promise(() => {});
      return result;
    }, options);
  const envelope = decodeEnvelope(claim.envelope);
  await processEvent(envelope.event, envelope.serviceId, envelope.integrationId, envelope, {
    id: claim.id,
    token: claim.leaseToken,
  });
})().catch(() => {
  process.exitCode = 1;
});
