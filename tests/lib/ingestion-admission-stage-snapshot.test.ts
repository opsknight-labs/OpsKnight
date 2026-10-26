import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { parseAdmissionStages, parseEventStages, summarizeStages } = createRequire(import.meta.url)(
  '../../scripts/ingestion/admission-stage-snapshot.cjs'
);

describe('bounded native admission telemetry', () => {
  it('keeps only declared stages and numeric histogram values', () => {
    const labels = 'stage="reservation",outcome="success"';
    expect(
      parseAdmissionStages(
        [
          'unrelated_metric{private="discarded"} 99',
          `opsknight_ingestion_admission_stage_duration_ms_bucket{${labels},le="10"} 2`,
          `opsknight_ingestion_admission_stage_duration_ms_bucket{${labels},le="+Inf"} 3`,
          `opsknight_ingestion_admission_stage_duration_ms_sum{${labels}} 24.5`,
          `opsknight_ingestion_admission_stage_duration_ms_count{${labels}} 3`,
        ].join('\n')
      )
    ).toEqual([
      {
        stage: 'reservation',
        outcome: 'success',
        sumMs: 24.5,
        count: 3,
        buckets: [
          { upperBoundMs: 10, cumulativeCount: 2 },
          { upperBoundMs: null, cumulativeCount: 3 },
        ],
      },
    ]);
  });
  it('rejects undeclared labels and nonnumeric telemetry', () => {
    expect(() =>
      parseAdmissionStages(
        'opsknight_ingestion_admission_stage_duration_ms_count{stage="reservation",outcome="success",serviceId="private"} 1'
      )
    ).toThrow();
    expect(() =>
      parseAdmissionStages(
        'opsknight_ingestion_admission_stage_duration_ms_count{stage="reservation",outcome="success"} NaN'
      )
    ).toThrow();
  });
});

it('keeps event driver stages separate and rejects identity labels', () => {
  const body =
    'opsknight_event_stage_duration_ms_count{stage="transaction-acquire",outcome="success"} 2';
  expect(parseAdmissionStages(body)).toEqual([]);
  expect(parseEventStages(body)).toEqual([
    { stage: 'transaction-acquire', outcome: 'success', count: 2, buckets: [] },
  ]);
  expect(() =>
    parseEventStages(body.replace('outcome="success"', 'outcome="success",incidentId="private"'))
  ).toThrow();
});

it('accepts fixed request and queue stages without request identities', () => {
  for (const stage of [
    'authentication',
    'body-read',
    'body-parse',
    'validation',
    'quota',
    'quota-wait',
    'quota-policy',
    'quota-database',
    'envelope',
    'hashing',
    'byte-count',
    'append-wait',
  ]) {
    const rows = parseAdmissionStages(
      `opsknight_ingestion_admission_stage_duration_ms_count{stage="${stage}",outcome="success"} 1`
    );
    expect(rows[0].stage).toBe(stage);
  }
});

it('reports conservative percentile bucket bounds and unbounded tails', () => {
  expect(
    summarizeStages([
      {
        stage: 'quota',
        outcome: 'success',
        count: 100,
        sumMs: 500,
        buckets: [
          { upperBoundMs: null, cumulativeCount: 100 },
          { upperBoundMs: 10, cumulativeCount: 96 },
          { upperBoundMs: 1, cumulativeCount: 50 },
        ],
      },
    ])[0]
  ).toEqual({
    stage: 'quota',
    outcome: 'success',
    count: 100,
    meanMs: 5,
    percentileUpperBoundsMs: { p50: 1, p95: 10, p99: null },
  });
});
