import { describe, expect, it, vi } from 'vitest';
import {
  averageInFlight,
  beginIngestionActivity,
  snapshotIngestionActivity,
  type IngestionActivitySnapshot,
} from '@/lib/ingestion/activity';
import { IngestionYield } from '@/lib/intelligence/jobs/ingestion-yield';

vi.mock('server-only', () => ({}));

/** A controllable activity source: `load` events in flight, constant over each advance. */
function fakeActivity() {
  const state = { at: 0, integralMs: 0, inFlight: 0 };
  return {
    source: (): IngestionActivitySnapshot => ({ ...state }),
    run(ms: number, inFlight: number) {
      state.inFlight = inFlight;
      state.integralMs += inFlight * ms;
      state.at += ms;
    },
  };
}

describe('in-process ingestion activity', () => {
  it('counts events in flight and integrates them over time', () => {
    const before = snapshotIngestionActivity();
    const endA = beginIngestionActivity();
    const endB = beginIngestionActivity();
    expect(snapshotIngestionActivity().inFlight).toBe(before.inFlight + 2);
    endA();
    endA(); // releasing twice never double-counts
    expect(snapshotIngestionActivity().inFlight).toBe(before.inFlight + 1);
    endB();
    const after = snapshotIngestionActivity(before.at + 10_000);
    expect(after.inFlight).toBe(before.inFlight);
    expect(after.integralMs).toBeGreaterThanOrEqual(before.integralMs);
  });

  it('averages the in-flight count between two snapshots', () => {
    expect(
      averageInFlight(
        { inFlight: 0, integralMs: 0, at: 0 },
        { inFlight: 2, integralMs: 400, at: 100 }
      )
    ).toBe(4);
    // No time passed: fall back to the instantaneous count.
    expect(
      averageInFlight({ inFlight: 3, integralMs: 5, at: 7 }, { inFlight: 3, integralMs: 5, at: 7 })
    ).toBe(3);
  });
});

describe('lane yield to ingestion', () => {
  it('starts yielding once the average load reaches the threshold, not on a single short event', () => {
    const activity = fakeActivity();
    const gate = new IngestionYield(activity.source);
    activity.run(100, 0.5); // half an event in flight on average: light ingestion
    expect(gate.isYielding()).toBe(false);
    activity.run(100, 8);
    expect(gate.isYielding()).toBe(true);
    expect(gate.load).toBe(8);
  });

  it('ignores windows shorter than the sample interval', () => {
    const activity = fakeActivity();
    const gate = new IngestionYield(activity.source, { sampleMs: 50 });
    activity.run(10, 20);
    expect(gate.isYielding()).toBe(false); // 10 ms is too short to judge
    activity.run(40, 20);
    expect(gate.isYielding()).toBe(true);
  });

  it('keeps yielding through a short lull and resumes only after the hold period (hysteresis)', () => {
    const activity = fakeActivity();
    const gate = new IngestionYield(activity.source, { holdMs: 1_000, exitLoad: 0.25 });
    activity.run(100, 8);
    expect(gate.isYielding()).toBe(true);
    // Between the enter and exit thresholds: still busy.
    activity.run(500, 0.5);
    expect(gate.isYielding()).toBe(true);
    // Quiet, but not for long enough.
    activity.run(600, 0);
    expect(gate.isYielding()).toBe(true);
    // A blip resets the quiet period.
    activity.run(100, 1);
    expect(gate.isYielding()).toBe(true);
    activity.run(900, 0);
    expect(gate.isYielding()).toBe(true);
    activity.run(200, 0);
    expect(gate.isYielding()).toBe(true);
    activity.run(900, 0);
    expect(gate.isYielding()).toBe(false);
  });

  it('pauses for the duty-cycle share of the work, capped, and not at all when ingestion is quiet', async () => {
    const activity = fakeActivity();
    const slept: number[] = [];
    const gate = new IngestionYield(
      activity.source,
      { duty: 0.2, maxPauseMs: 1_000, pollMs: 25 },
      async ms => {
        slept.push(ms);
        activity.run(ms, 8);
      }
    );
    expect(await gate.pause(100)).toBe(0); // not yielding: no pause
    activity.run(100, 8);
    expect(await gate.pause(100)).toBe(400); // 100 ms of work at 20% duty → 400 ms pause
    expect(slept.every(ms => ms <= 25)).toBe(true);
    expect(await gate.pause(10_000)).toBe(1_000); // capped
    expect(gate.pausedMs).toBe(1_400);
  });

  it('stops pausing as soon as ingestion goes quiet for the hold period', async () => {
    const activity = fakeActivity();
    const gate = new IngestionYield(
      activity.source,
      { duty: 0.1, maxPauseMs: 5_000, pollMs: 50, holdMs: 200 },
      async ms => activity.run(ms, 0)
    );
    activity.run(100, 4);
    const waited = await gate.pause(1_000);
    expect(waited).toBeLessThan(5_000);
    expect(waited).toBeGreaterThanOrEqual(200);
    expect(gate.isYielding()).toBe(false);
  });

  it('waits at least the requested floor while yielding, capped, and not at all when quiet', async () => {
    const activity = fakeActivity();
    const gate = new IngestionYield(
      activity.source,
      { duty: 0.2, maxPauseMs: 1_000, pollMs: 25, backoffFloorMs: 100 },
      async ms => activity.run(ms, 8)
    );
    expect(gate.backoffFloorMs).toBe(100);
    expect(await gate.pause(0, undefined, 100)).toBe(0); // quiet: the floor does not apply
    activity.run(100, 8);
    // Almost no work (a cycle that backed off) still waits the floor, not 4x of nearly nothing.
    expect(await gate.pause(1, undefined, 100)).toBe(100);
    // More work than the floor implies keeps the duty-cycle pause.
    expect(await gate.pause(100, undefined, 100)).toBe(400);
    expect(await gate.pause(0, undefined, 5_000)).toBe(1_000); // the cap still holds
  });

  it('ends a pause when the lane is aborted', async () => {
    const activity = fakeActivity();
    const controller = new AbortController();
    const gate = new IngestionYield(activity.source, { duty: 0.1, pollMs: 25 }, async ms => {
      activity.run(ms, 8);
      controller.abort();
    });
    activity.run(100, 8);
    expect(await gate.pause(1_000, controller.signal)).toBe(25);
  });
});
