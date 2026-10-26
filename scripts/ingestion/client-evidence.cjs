/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS certification helper. */
/* eslint-disable security/detect-non-literal-fs-filename -- Caller supplies owned local certification artifact paths. */
const { readFileSync } = require('node:fs');

// Client artifacts survive database failure and topology cleanup. Raw ledger
// records contain fixture delivery/receipt identities only, never bodies/keys.
function readClientEvidence(summaryPath, ledgerPath) {
  let summary = null;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch {
    /* absent/incomplete */
  }
  let recordedAcknowledgments = 0;
  let malformedRecords = 0;
  const receipts = new Set();
  const deliveries = new Set();
  let ledgerReadable = true;
  try {
    for (const line of readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        if (
          row.kind !== 'opsknight-ack' ||
          typeof row.receiptId !== 'string' ||
          typeof row.deliveryId !== 'string' ||
          !row.receiptId ||
          !row.deliveryId
        )
          throw new Error('Invalid fixture ledger record');
        recordedAcknowledgments++;
        receipts.add(row.receiptId);
        deliveries.add(row.deliveryId);
      } catch {
        malformedRecords++;
      }
    }
  } catch {
    ledgerReadable = false;
  }
  const summaryAcknowledged = summary?.metrics?.ingestion_durable_accepted?.count;
  return {
    summaryPath,
    ledgerPath,
    summary,
    ledger: {
      readable: ledgerReadable,
      recordedAcknowledgments,
      uniqueReceiptIds: receipts.size,
      uniqueDeliveryIds: deliveries.size,
      malformedRecords,
    },
    clientCountsMatch:
      ledgerReadable &&
      malformedRecords === 0 &&
      Number.isSafeInteger(summaryAcknowledged) &&
      summaryAcknowledged === recordedAcknowledgments,
    scope:
      'Client observations only; receipt identities require separate database recovery reconciliation. No certificate from counts alone.',
  };
}
module.exports = { readClientEvidence };
