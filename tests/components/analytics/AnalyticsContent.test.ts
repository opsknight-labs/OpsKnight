import { describe, expect, it } from 'vitest';
import {
  buildSparklineAreaPath,
  buildSparklinePath,
} from '@/components/analytics/AnalyticsContent';

describe('analytics KPI sparkline no-data semantics', () => {
  it('starts a new segment after temporal gaps', () => {
    const line = buildSparklinePath([20, null, null, 40]);

    expect(line.match(/M/g)).toHaveLength(2);
    expect(line).not.toContain('L72.0');
  });

  it('closes each area segment independently around gaps', () => {
    const area = buildSparklineAreaPath([20, null, 40, 50]);

    expect(area.match(/Z/g)).toHaveLength(2);
  });
});
