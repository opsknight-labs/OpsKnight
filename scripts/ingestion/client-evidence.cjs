/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS certification helper. */
/* eslint-disable security/detect-non-literal-fs-filename -- Caller supplies owned local certification artifact paths. */
const { readFileSync } = require('node:fs');

// Client observations are fixture identities/times/statuses only, never bodies
// or keys. Rejections are observations, never durable acknowledgments.
function readClientRecords(ledgerPath) {
  const acknowledgments = [];
  const rejections = [];
  let malformedRecords = 0;
  let readable = true;
  try {
    for (const line of readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        if (typeof row.deliveryId !== 'string' || !row.deliveryId)
          throw new Error('Invalid delivery');
        if (
          row.observedAt !== undefined &&
          (!Number.isSafeInteger(row.observedAt) || row.observedAt < 0)
        )
          throw new Error('Invalid observation time');
        if (
          row.durationMs !== undefined &&
          row.durationMs !== null &&
          (!Number.isFinite(row.durationMs) || row.durationMs < 0)
        )
          throw new Error('Invalid observation duration');
        if (row.kind === 'opsknight-ack') {
          if (
            typeof row.receiptId !== 'string' ||
            !row.receiptId ||
            (row.status !== undefined && row.status !== 202)
          )
            throw new Error('Invalid receipt');
          acknowledgments.push(row);
        } else if (row.kind === 'opsknight-rejection') {
          if (
            !Number.isSafeInteger(row.status) ||
            row.status < 0 ||
            row.status > 599 ||
            !Number.isSafeInteger(row.observedAt)
          )
            throw new Error('Invalid rejection');
          rejections.push(row);
        } else throw new Error('Invalid fixture observation');
      } catch {
        malformedRecords++;
      }
    }
  } catch {
    readable = false;
  }
  return { acknowledgments, rejections, malformedRecords, readable };
}
function readClientEvidence(summaryPath, ledgerPath) {
  let summary = null;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch {
    /* absent/incomplete */
  }
  const records = readClientRecords(ledgerPath);
  const receipts = new Set(records.acknowledgments.map(row => row.receiptId));
  const deliveries = new Set(records.acknowledgments.map(row => row.deliveryId));
  const summaryAcknowledged = summary?.metrics?.ingestion_durable_accepted?.count;
  return {
    summaryPath,
    ledgerPath,
    summary,
    ledger: {
      readable: records.readable,
      recordedAcknowledgments: records.acknowledgments.length,
      recordedRejections: records.rejections.length,
      uniqueReceiptIds: receipts.size,
      uniqueDeliveryIds: deliveries.size,
      malformedRecords: records.malformedRecords,
    },
    clientCountsMatch:
      records.readable &&
      records.malformedRecords === 0 &&
      Number.isSafeInteger(summaryAcknowledged) &&
      summaryAcknowledged === records.acknowledgments.length,
    scope:
      'Client observations only; receipt identities require separate database recovery reconciliation. Rejections are never counted as acknowledgments. No certificate from counts alone.',
  };
}
module.exports = { readClientEvidence, readClientRecords };
