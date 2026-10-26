import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  measureAdmissionComputation,
  measureAdmissionStage,
} from '@/lib/ingestion/admission-timing';
import {
  clearRuntimeOperationalMetrics,
  OperationalMetricSnapshot,
} from '@/lib/metrics/operational/registry';

beforeEach(() => clearRuntimeOperationalMetrics());

describe('admission timing preserves operation semantics', () => {
  it('records synchronous failures without capturing their contents', () => {
    const error = new Error('private-payload-marker');
    expect(() =>
      measureAdmissionComputation('body-parse', () => {
        throw error;
      })
    ).toThrow(error);
    const rendered = new OperationalMetricSnapshot().render();
    expect(rendered).toContain('stage="body-parse",outcome="failure"');
    expect(rendered).not.toContain(error.message);
  });

  it('observes a pending operation only when it settles', async () => {
    let finish!: (value: number) => void;
    const work = vi.fn(
      () =>
        new Promise<number>(resolve => {
          finish = resolve;
        })
    );
    const result = measureAdmissionStage('quota', work);
    expect(new OperationalMetricSnapshot().render()).not.toContain('stage="quota"');
    finish(42);
    expect(await result).toBe(42);
    expect(work).toHaveBeenCalledTimes(1);
    const rendered = new OperationalMetricSnapshot().render();
    expect(rendered).toContain('stage="quota",outcome="success"');
  });
});
