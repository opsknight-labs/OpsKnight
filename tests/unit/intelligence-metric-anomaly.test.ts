// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  baselineValuesAt,
  cleanSeries,
  detectDeviations,
  judgeSamples,
  MAD_TO_SIGMA,
  median,
  medianAbsoluteDeviation,
  WEEK_MS,
  type HistoryWeek,
  type SamplePoint,
} from '@/lib/intelligence/metric-anomaly/detector';
import { scoreMetricAnomaly } from '@/lib/intelligence/metric-anomaly/scoring';
import {
  describeMetricStatus,
  metricTemplateInputSchema,
} from '@/lib/intelligence/metric-anomaly/contract';
import { RESPONSE_LIMITS } from '@/lib/intelligence/contract';
import { CONNECTOR_ADAPTERS } from '@/lib/intelligence/connectors/adapters';
import { KIND_CAPABILITIES, OBSERVABILITY_KINDS } from '@/lib/intelligence/connectors/contract';

const STEP = 60_000;
const START = Date.parse('2026-11-10T09:00:00Z');
const MINUTES = 60;

/** Deterministic pseudo-noise in [-1, 1]. */
const noise = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/** A strongly seasonal signal: a daily cycle with amplitude 50 around 100, plus small noise. */
const seasonal = (at: number, seed: number) =>
  100 + 50 * Math.sin((2 * Math.PI * (at % 86_400_000)) / 86_400_000) + noise(seed) * 2;

function series(
  start: number,
  count: number,
  value: (at: number, index: number) => number
): SamplePoint[] {
  return Array.from({ length: count }, (_, index) => {
    const at = start + index * STEP;
    return [at, value(at, index)] as const;
  });
}

function history(
  weeks: number,
  value: (at: number, index: number, weeksAgo: number) => number
): HistoryWeek[] {
  return Array.from({ length: weeks }, (_, index) => {
    const weeksAgo = index + 1;
    const start = START - weeksAgo * WEEK_MS - 2 * STEP;
    return { weeksAgo, points: series(start, MINUTES + 4, (at, i) => value(at, i, weeksAgo)) };
  });
}

const options = { thresholdMad: 5, direction: 'BOTH' as const, stepMs: STEP };

describe('robust statistics', () => {
  it('computes median and MAD, ignoring order', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 100])).toBe(1);
  });

  it('cleans series: drops non-finite values, sorts, and keeps one value per timestamp', () => {
    expect(
      cleanSeries([
        [3, 1],
        [1, Number.NaN],
        [2, 5],
        [3, 7],
        [Number.POSITIVE_INFINITY, 1],
      ])
    ).toEqual([
      [2, 5],
      [3, 7],
    ]);
  });

  it('takes baseline values from the same time of week, with a neighbourhood', () => {
    const weeks = [
      { weeksAgo: 1, points: series(START - WEEK_MS - STEP, 3, () => 10) },
      { weeksAgo: 2, points: series(START - 2 * WEEK_MS - STEP, 3, () => 20) },
    ];
    expect(baselineValuesAt(START, weeks, STEP, 0)).toEqual([10, 20]);
    expect(baselineValuesAt(START, weeks, STEP, 1)).toEqual([10, 10, 10, 20, 20, 20]);
  });
});

describe('seasonal detection', () => {
  it('finds nothing when the current window follows the weekly seasonal shape', () => {
    const current = series(START, MINUTES, (at, i) => seasonal(at, i + 999));
    const past = history(4, (at, i, weeksAgo) => seasonal(at, i * 7 + weeksAgo));
    expect(detectDeviations(current, past, options)).toEqual([]);
  });

  it('does not mistake the daily cycle for an anomaly where a flat baseline would', () => {
    // The same instant a day earlier sits on a very different part of the cycle; a week earlier does not.
    const current = series(START, MINUTES, (at, i) => seasonal(at, i + 5));
    const weekly = history(4, (at, i, weeksAgo) => seasonal(at, i + weeksAgo * 100));
    const shiftedByHalfDay = history(4, (at, i, weeksAgo) =>
      seasonal(at + 43_200_000, i + weeksAgo * 100)
    );
    expect(detectDeviations(current, weekly, options)).toEqual([]);
    expect(detectDeviations(current, shiftedByHalfDay, options).length).toBeGreaterThan(0);
  });

  it('reports a spike at its first sample with its size in MAD, and the peak', () => {
    const spikeFrom = 30;
    const current = series(
      START,
      MINUTES,
      (at, i) =>
        seasonal(at, i + 3) + (i >= spikeFrom && i < spikeFrom + 4 ? (i === 31 ? 120 : 80) : 0)
    );
    const past = history(4, (at, i, weeksAgo) => seasonal(at, i * 3 + weeksAgo));
    const [deviation, ...rest] = detectDeviations(current, past, options);
    expect(rest).toEqual([]);
    expect(deviation.at).toBe(START + spikeFrom * STEP);
    expect(deviation.endAt).toBe(START + (spikeFrom + 3) * STEP);
    expect(deviation.peakAt).toBe(START + 31 * STEP);
    expect(deviation.direction).toBe('UP');
    expect(deviation.points).toBe(4);
    expect(deviation.score).toBeGreaterThan(5);
    // The score is the deviation from the median in robust standard units.
    const expected =
      (deviation.value - deviation.baselineMedian) /
      Math.max(MAD_TO_SIGMA * deviation.baselineMad, 0.01 * Math.abs(deviation.baselineMedian));
    expect(deviation.score).toBeCloseTo(expected, 6);
  });

  it('ignores a single-sample blip but honours minConsecutive = 1', () => {
    const current = series(START, MINUTES, (at, i) => seasonal(at, i) + (i === 10 ? 200 : 0));
    const past = history(4, (at, i, weeksAgo) => seasonal(at, i + weeksAgo * 13));
    expect(detectDeviations(current, past, options)).toEqual([]);
    const single = detectDeviations(current, past, { ...options, minConsecutive: 1 });
    expect(single).toHaveLength(1);
    expect(single[0].at).toBe(START + 10 * STEP);
  });

  it('respects the direction filter and splits a run that changes direction', () => {
    const current = series(START, MINUTES, (at, i) =>
      i >= 20 && i < 23 ? 1_000 : i >= 23 && i < 26 ? -1_000 : 100 + noise(i)
    );
    const past = history(3, (_at, i, weeksAgo) => 100 + noise(i * 11 + weeksAgo));
    const both = detectDeviations(current, past, options);
    expect(both.map(deviation => [deviation.direction, deviation.points])).toEqual([
      ['UP', 3],
      ['DOWN', 3],
    ]);
    expect(detectDeviations(current, past, { ...options, direction: 'DOWN' })).toHaveLength(1);
    expect(detectDeviations(current, past, { ...options, direction: 'UP' })[0].direction).toBe(
      'UP'
    );
  });

  it('is robust to an outage in one history week', () => {
    const current = series(START, MINUTES, (at, i) => seasonal(at, i + 7));
    const past = history(4, (at, i, weeksAgo) =>
      weeksAgo === 2 ? 5_000 : seasonal(at, i * 5 + weeksAgo)
    );
    expect(detectDeviations(current, past, options)).toEqual([]);
  });
});

describe('flat lines', () => {
  it('does not flag a flat line that stays flat, even with MAD = 0', () => {
    const current = series(START, MINUTES, () => 42);
    const past = history(4, () => 42);
    const judged = judgeSamples(current, past, options);
    expect(judged.every(sample => sample.mad === 0 && sample.score === 0)).toBe(true);
    expect(detectDeviations(current, past, options)).toEqual([]);
  });

  it('flags a step change off a flat history, scaled by the relative floor', () => {
    const current = series(START, MINUTES, (_at, i) => (i >= 40 ? 50 : 42));
    const past = history(4, () => 42);
    const [deviation] = detectDeviations(current, past, options);
    expect(deviation.at).toBe(START + 40 * STEP);
    // Scale floor = 1% of the median (0.42): (50 - 42) / 0.42.
    expect(deviation.score).toBeCloseTo(8 / 0.42, 6);
  });

  it('ignores changes smaller than minDeviation, e.g. a zero counter ticking to one', () => {
    const current = series(START, MINUTES, (_at, i) => (i >= 40 ? 1 : 0));
    const past = history(4, () => 0);
    expect(detectDeviations(current, past, options)).toHaveLength(1);
    expect(detectDeviations(current, past, { ...options, minDeviation: 5 })).toEqual([]);
  });
});

describe('gaps', () => {
  it('does not judge samples without enough baseline values', () => {
    const current = series(START, MINUTES, () => 1_000);
    const thin = history(4, () => 1).map(week =>
      week.weeksAgo === 1 ? week : { ...week, points: [] }
    );
    // One week with the neighbourhood gives three values: exactly the minimum.
    expect(detectDeviations(current, thin, options).length).toBe(1);
    expect(detectDeviations(current, thin, { ...options, minBaselineSamples: 4 }).length).toBe(0);
    expect(detectDeviations(current, [], options)).toEqual([]);
    expect(judgeSamples(current, [], options).every(sample => sample.score === null)).toBe(true);
  });

  it('ends a run at a gap in the current series', () => {
    const points = series(START, MINUTES, (_at, i) => (i >= 20 && i < 30 ? 500 : 100)).filter(
      ([at]) => at !== START + 25 * STEP
    );
    const past = history(4, (_at, i) => 100 + noise(i));
    const deviations = detectDeviations(points, past, options);
    expect(deviations.map(deviation => [deviation.at, deviation.points])).toEqual([
      [START + 20 * STEP, 5],
      [START + 26 * STEP, 4],
    ]);
  });

  it('tolerates gaps in history weeks and non-finite samples', () => {
    const current = series(START, MINUTES, (at, i) => seasonal(at, i));
    const past = history(4, (at, i, weeksAgo) =>
      i % 3 === 0 ? Number.NaN : seasonal(at, i + weeksAgo * 17)
    );
    expect(detectDeviations(current, past, options)).toEqual([]);
  });
});

describe('metric anomaly scoring', () => {
  const base = { relation: 'SAME_SERVICE' as const, depth: 0, score: 10, thresholdMad: 5 };

  it('ranks closer, stronger, same-service deviations higher and never reaches certainty', () => {
    const near = scoreMetricAnomaly({ ...base, leadSeconds: 60 });
    const far = scoreMetricAnomaly({ ...base, leadSeconds: 3 * 3600 });
    const upstream = scoreMetricAnomaly({
      ...base,
      relation: 'UPSTREAM',
      depth: 2,
      leadSeconds: 60,
    });
    const weak = scoreMetricAnomaly({ ...base, score: 5, leadSeconds: 60 });
    expect(near.confidence).toBeGreaterThan(far.confidence);
    expect(near.confidence).toBeGreaterThan(upstream.confidence);
    expect(near.confidence).toBeGreaterThan(weak.confidence);
    expect(near.confidence).toBeLessThanOrEqual(RESPONSE_LIMITS.maxCauseConfidence);
    expect(weak.components.strength).toBe(0.5);
    expect(near.components.strength).toBe(1);
  });

  it('accepts a short grace after onset and rejects anything outside the window', () => {
    expect(scoreMetricAnomaly({ ...base, leadSeconds: -5 * 60 }).confidence).toBeGreaterThan(0);
    expect(scoreMetricAnomaly({ ...base, leadSeconds: -11 * 60 }).confidence).toBe(0);
    expect(
      scoreMetricAnomaly({
        ...base,
        leadSeconds: RESPONSE_LIMITS.causeLookbackMinutes * 60 + 1,
      }).confidence
    ).toBe(0);
    expect(scoreMetricAnomaly({ ...base, leadSeconds: Number.NaN }).confidence).toBe(0);
  });
});

describe('metric template contract', () => {
  const valid = {
    serviceId: 'svc',
    connectionId: 'conn',
    name: 'p99 latency',
    query: 'histogram_quantile(0.99, rate(x[5m]))',
  };

  it('defaults to off with documented defaults', () => {
    const parsed = metricTemplateInputSchema.parse(valid);
    expect(parsed).toMatchObject({
      enabled: false,
      direction: 'BOTH',
      thresholdMad: 5,
      baselineWeeks: 4,
      windowMinutes: 60,
      stepSeconds: 60,
      intervalMinutes: 15,
      minDeviation: 0,
    });
  });

  it('rejects out-of-range values, unknown keys and a step that does not fit the window', () => {
    expect(metricTemplateInputSchema.safeParse({ ...valid, thresholdMad: 1 }).success).toBe(false);
    expect(metricTemplateInputSchema.safeParse({ ...valid, baselineWeeks: 9 }).success).toBe(false);
    expect(metricTemplateInputSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
    expect(
      metricTemplateInputSchema.safeParse({ ...valid, windowMinutes: 15, stepSeconds: 300 }).success
    ).toBe(false);
  });

  it('describes evaluation statuses for administrators', () => {
    expect(describeMetricStatus(null)).toBe('Not evaluated yet');
    expect(describeMetricStatus('OK')).toBe('Evaluated');
    expect(describeMetricStatus('CONNECTOR_ERROR:TIMEOUT')).toBe(
      'The connection did not answer (timeout)'
    );
  });
});

describe('raw series capability of the connectors', () => {
  it('is offered exactly by the kinds that answer metric queries', () => {
    for (const kind of OBSERVABILITY_KINDS) {
      // eslint-disable-next-line security/detect-object-injection -- closed union
      const adapter = CONNECTOR_ADAPTERS[kind];
      // eslint-disable-next-line security/detect-object-injection -- closed union
      const metrics = KIND_CAPABILITIES[kind].includes('metrics');
      expect(Boolean(adapter.series), kind).toBe(metrics);
      expect(Boolean(adapter.metrics), kind).toBe(metrics);
    }
  });

  it('returns every Prometheus point, where the summary keeps only a few', async () => {
    const values = Array.from({ length: 60 }, (_, i) => [1_700_000_000 + i * 60, String(i)]);
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            data: { resultType: 'matrix', result: [{ metric: { job: 'api' }, values }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const context = {
      connection: {
        id: 'c',
        name: 'prom',
        kind: 'PROMETHEUS' as const,
        baseUrl: 'https://prom.example.com',
        region: null,
        org: null,
        project: null,
        allowPrivateNetwork: false,
        timeoutMs: 5_000,
        credential: {},
      },
      fetch,
    };
    const window = { start: new Date(1_700_000_000_000), end: new Date(1_700_003_600_000) };
    const raw = await CONNECTOR_ADAPTERS.PROMETHEUS.series!(context, {
      query: 'up',
      window,
      stepSeconds: 60,
    });
    expect(raw).toHaveLength(1);
    expect(raw[0].points).toHaveLength(60);
    expect(raw[0].points[59]).toEqual([(1_700_000_000 + 59 * 60) * 1000, 59]);
    const summary = await CONNECTOR_ADAPTERS.PROMETHEUS.metrics!(context, {
      query: 'up',
      window,
      stepSeconds: 60,
    });
    expect(summary.series[0].points).toBe(60);
    expect(summary.series[0].samples.length).toBeLessThan(60);
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe('/api/v1/query_range');
    expect(url.searchParams.get('step')).toBe('60');
  });
});
