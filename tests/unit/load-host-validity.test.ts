import { describe, expect, it } from 'vitest';
import {
  judgeHostSamples,
  otherHeavyProcesses,
  parsePs,
  type HostSample,
} from '../load/helpers/host-validity';
import { laneWorkInBurstMs } from '../load/helpers/lane-busy';

const sample = (at: number, load1: number, otherHeavy: string[] = []): HostSample => ({
  at,
  load1,
  otherHeavy,
});

describe('benchmark host validity', () => {
  it('accepts a quiet host and records the peak without judging it', () => {
    const verdict = judgeHostSamples([sample(0, 3.2), sample(3, 5.5), sample(6, 6.1)]);
    expect(verdict).toMatchObject({ valid: true, reasons: [], startLoad1: 3.2, peakLoad1: 6.1 });
  });

  it('rejects a loaded start, a stall and another heavy process, each with its reason', () => {
    expect(judgeHostSamples([sample(0, 4), sample(3, 4), sample(6, 4)]).reasons).toEqual([
      '1-minute load at start 4 is not below 4',
    ]);
    expect(judgeHostSamples([sample(0, 1), sample(3, 1), sample(30, 1)]).reasons).toEqual([
      'host stalled: 27 s between samples',
    ]);
    const heavy = judgeHostSamples([sample(0, 1), sample(3, 1, ['node vitest run']), sample(6, 1)]);
    expect(heavy.valid).toBe(false);
    expect(heavy.otherHeavyProcesses).toEqual(['node vitest run']);
    expect(judgeHostSamples([]).valid).toBe(false);
  });

  it('counts heavy processes of others, never the benchmark own ancestors or children', () => {
    const rows = parsePs(
      [
        '  10     1 /bin/zsh campaign.sh',
        '  20    10 node ts-node tests/load/intelligence-ingestion-ab.ts',
        '  21    20 node esbuild --service',
        '  22    20 node /x/node_modules/.bin/vitest run child',
        '  30     1 node /x/node_modules/.bin/tsc --noEmit',
        '  31     1 node /x/node_modules/.bin/vitest run -c vitest.unit.config.ts',
        '  32     1 node tsserver.js',
        '  33    10 node ts-node tests/load/intelligence-storm.ts',
      ].join('\n')
    );
    expect(otherHeavyProcesses(rows, 20)).toEqual([
      'node /x/node_modules/.bin/tsc --noEmit',
      'node /x/node_modules/.bin/vitest run -c vitest.unit.config.ts',
      'node ts-node tests/load/intelligence-storm.ts',
    ]);
  });

  it('does not take a shell that only mentions a heavy tool for the tool itself', () => {
    const rows = parsePs(
      [
        '  20     1 node ts-node tests/load/intelligence-ingestion-ab.ts',
        // Wrapper scripts of other sessions waiting for the machine lock: asleep, not compiling.
        '  40     1 /bin/zsh -c source snapshot.sh && until mkdir /tmp/lock; do sleep 15; done; npx tsc --noEmit',
        '  41    40 bash /scratch/heavy.sh tsc build e2e',
        '  42     1 /bin/bash /scratch/p2evals-tsc.sh',
        '  43     1 sh -c vitest run',
        // The tool itself, once such a wrapper starts it, still counts.
        '  44    41 node /x/node_modules/.bin/tsc --noEmit --incremental false',
        '  45    43 npm exec vitest run',
      ].join('\n')
    );
    expect(otherHeavyProcesses(rows, 20)).toEqual([
      'node /x/node_modules/.bin/tsc --noEmit --incremental false',
      'npm exec vitest run',
    ]);
  });
});

describe('lane work inside the timed burst', () => {
  it('is the union of handler spans clipped to the burst', () => {
    // Before the burst, overlapping inside it, and running past its end (1 s burst).
    expect(
      laneWorkInBurstMs(
        [
          { startMs: -200, endMs: 100 },
          { startMs: 50, endMs: 300 },
          { startMs: 900, endMs: null },
        ],
        1
      )
    ).toBe(400);
  });

  it('is zero when the lane only worked around the burst', () => {
    expect(laneWorkInBurstMs([{ startMs: -500, endMs: -10 }], 1)).toBe(0);
    expect(laneWorkInBurstMs([{ startMs: 1000, endMs: 1500 }], 1)).toBe(0);
    expect(laneWorkInBurstMs(undefined, 1)).toBe(0);
  });
});
