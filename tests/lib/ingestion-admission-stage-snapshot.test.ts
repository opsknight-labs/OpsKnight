import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { parseAdmissionStages, parseEventStages } = createRequire(import.meta.url)(
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
