import fs from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it('measures failed attempts plus backoff and the successful attempt as one operation', () => {
  const source = fs
    .readFileSync('tests/load/scenarios/automation.js', 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace(/^export \{.*\};$/gm, '')
    .replace('export const options', 'const options')
    .replace('export default function ()', 'function runOperation()');
  const observations = new Map<string, number[]>();
  class Metric {
    constructor(private name: string) {
      observations.set(name, []);
    }
    add(value: number) {
      observations.get(this.name)!.push(value);
    }
  }
  let clock = 0,
    attempt = 0;
  const context = vm.createContext({
    Trend: Metric,
    Counter: Metric,
    Date: { now: () => clock },
    __ENV: {},
    __VU: 1,
    __ITER: 0,
    execution: { scenario: { iterationInTest: 0 } },
    loadSeedManifest: () => ({ capacityIntegrationKeys: ['fixture-key'] }),
    getBaseUrl: () => 'http://fixture',
    sleep: (seconds: number) => {
      clock += seconds * 1000;
    },
    check: () => true,
    postEventApi: () => {
      attempt++;
      const duration = attempt === 1 ? 100 : 20;
      clock += duration;
      return { status: attempt === 1 ? 500 : 202, timings: { duration } };
    },
  });
  vm.runInContext(source + '\nrunOperation();', context);
  expect(observations.get('automation_ingestion_latency_ms')).toEqual([320]);
  expect(observations.get('automation_http_attempt_latency_ms')).toEqual([100, 20]);
  expect(observations.get('automation_retry_backoff_ms')).toEqual([200]);
  expect(observations.get('automation_http_retries')!.reduce((sum, value) => sum + value, 0)).toBe(
    1
  );
  expect(observations.get('automation_accepted_events')).toEqual([1]);
});
