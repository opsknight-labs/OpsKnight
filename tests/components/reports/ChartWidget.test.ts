import { describe, expect, it } from 'vitest';
import { calculateTrend, getChartData } from '@/components/reports/widgets/ChartWidget';
import type { SerializedSLAMetrics } from '@/lib/sla';

describe('report chart no-data semantics', () => {
  it('preserves missing MTTA and SLA compliance instead of converting them to zero', () => {
    const metrics = {
      trendSeries: [{ label: 'Mon', mtta: null, mttr: null, ackCompliance: null, count: 1 }],
    } as unknown as SerializedSLAMetrics;

    expect(getChartData('responseTimesTrend', metrics)[0]?.value).toBeNull();
    expect(getChartData('resolutionTimesTrend', metrics)[0]?.value).toBeNull();
    expect(getChartData('slaComplianceTrend', metrics)[0]?.value).toBeNull();
  });

  it('calculates trends only from evaluable points', () => {
    expect(calculateTrend([{ value: null }, { value: 10 }, { value: null }, { value: 20 }])).toBe(
      100
    );
    expect(calculateTrend([{ value: null }, { value: null }])).toBeNull();
  });
});
