/* eslint-disable security/detect-non-literal-fs-filename -- Per-test private temporary directories. */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { readClientEvidence } = createRequire(import.meta.url)(
  '../../scripts/ingestion/client-evidence.cjs'
);
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ingestion-client-evidence-'));
  directories.push(dir);
  return { summary: join(dir, 'summary.json'), ledger: join(dir, 'acks.jsonl') };
}
describe('client evidence survives failed runs', () => {
  it('retains acknowledgments without a summary or database', () => {
    const f = fixture();
    writeFileSync(
      f.ledger,
      JSON.stringify({ kind: 'opsknight-ack', receiptId: 'receipt', deliveryId: 'delivery' }) + '\n'
    );
    const result = readClientEvidence(f.summary, f.ledger);
    expect(result.summary).toBeNull();
    expect(result.ledger.recordedAcknowledgments).toBe(1);
    expect(result.clientCountsMatch).toBe(false);
  });
  it('does not treat truncated records or absent files as reconciled', () => {
    const f = fixture();
    expect(readClientEvidence(f.summary, f.ledger).ledger.readable).toBe(false);
    writeFileSync(
      f.summary,
      JSON.stringify({ metrics: { ingestion_durable_accepted: { count: 1 } } })
    );
    writeFileSync(f.ledger, '{"kind":');
    const result = readClientEvidence(f.summary, f.ledger);
    expect(result.ledger.malformedRecords).toBe(1);
    expect(result.clientCountsMatch).toBe(false);
  });
  it('matches client counts while keeping database reconciliation separate', () => {
    const f = fixture();
    writeFileSync(
      f.summary,
      JSON.stringify({ metrics: { ingestion_durable_accepted: { count: 2 } } })
    );
    writeFileSync(
      f.ledger,
      ['a', 'b']
        .map(deliveryId =>
          JSON.stringify({ kind: 'opsknight-ack', receiptId: 'same-receipt', deliveryId })
        )
        .join('\n')
    );
    const result = readClientEvidence(f.summary, f.ledger);
    expect(result.clientCountsMatch).toBe(true);
    expect(result.ledger.uniqueReceiptIds).toBe(1);
    expect(result.ledger.uniqueDeliveryIds).toBe(2);
    expect(result).not.toHaveProperty('reconciled');
  });
});

it('keeps rejected response observations out of acknowledgment reconciliation', () => {
  const f = fixture();
  writeFileSync(
    f.summary,
    JSON.stringify({ metrics: { ingestion_durable_accepted: { count: 1 } } })
  );
  writeFileSync(
    f.ledger,
    [
      {
        kind: 'opsknight-ack',
        receiptId: 'receipt',
        deliveryId: 'accepted',
        status: 202,
        durationMs: 125,
        observedAt: 1000,
      },
      {
        kind: 'opsknight-rejection',
        deliveryId: 'rejected',
        status: 503,
        durationMs: 2,
        observedAt: 1010,
      },
    ]
      .map(row => JSON.stringify(row))
      .join('\n')
  );
  const result = readClientEvidence(f.summary, f.ledger);
  expect(result.clientCountsMatch).toBe(true);
  expect(result.ledger.recordedAcknowledgments).toBe(1);
  expect(result.ledger.recordedRejections).toBe(1);
});
