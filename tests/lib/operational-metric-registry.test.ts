import { describe, expect, it } from 'vitest';
import {
  OperationalMetricSnapshot,
  validateMetricDefinitions,
} from '@/lib/metrics/operational/registry';

describe('operational metric registry', () => {
  it('stays within the declared cardinality budget', () => {
    expect(validateMetricDefinitions().estimatedSeries).toBeLessThan(10_000);
  });

  it('emits HELP and TYPE exactly once and escapes labels', () => {
    const snapshot = new OperationalMetricSnapshot();
    snapshot.set('opsknight_jobs_pending', 2, { type: 'notify"batch' });
    snapshot.set('opsknight_jobs_pending', 1, { type: 'escalation' });
    const rendered = snapshot.render();
    expect(rendered.match(/# HELP opsknight_jobs_pending/g)).toHaveLength(1);
    expect(rendered.match(/# TYPE opsknight_jobs_pending/g)).toHaveLength(1);
    expect(rendered).toContain('type="notify\\"batch"');
  });

  it('rejects undeclared label shapes', () => {
    const snapshot = new OperationalMetricSnapshot();
    expect(() => snapshot.set('opsknight_jobs_pending', 1, { incidentId: 'secret' })).toThrow();
  });
});
