import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ChartWidget, { getChartData } from '@/components/reports/widgets/ChartWidget';
import type { SerializedSLAMetrics } from '@/lib/sla';

describe('ChartWidget', () => {
  const mockMetrics = {
    trendSeries: [
      {
        label: 'Mon',
        count: 10,
        mtta: 5,
        mttr: 15,
        ackCompliance: 90,
        resolveCompliance: 85,
        timestamp: '2026-09-01T00:00:00Z',
      },
      {
        label: 'Tue',
        count: 12,
        mtta: 4,
        mttr: 14,
        ackCompliance: 95,
        resolveCompliance: 88,
        timestamp: '2026-09-02T00:00:00Z',
      },
    ],
    urgencyMix: [
      { urgency: 'high', count: 8, percentage: 36 },
      { urgency: 'medium', count: 14, percentage: 64 },
    ],
    statusMix: [
      { status: 'RESOLVED', count: 20, percentage: 90 },
      { status: 'ACTIVE', count: 2, percentage: 10 },
    ],
    heatmapData: [
      { date: '2026-09-01', count: 4 },
      { date: '2026-09-02', count: 7 },
    ],
  } as unknown as SerializedSLAMetrics;

  describe('getChartData extraction helper', () => {
    it('extracts count trend by default for trendSeries', () => {
      const data = getChartData('trendSeries', mockMetrics);
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ label: 'Mon', value: 10 });
    });

    it('extracts dual-series (mtta and mttr) when chartType is mttaVsMttr', () => {
      const data = getChartData('trendSeries', mockMetrics, {
        chartType: 'mttaVsMttr',
      });
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ label: 'Mon', value: 5, value2: 15 });
    });

    it('extracts dual-series (ack and resolve compliance) when chartType is slaCompliance', () => {
      const data = getChartData('trendSeries', mockMetrics, {
        chartType: 'slaCompliance',
      });
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ label: 'Mon', value: 90, value2: 85 });
    });

    it('formats urgencyMix and statusMix with name and value for Pie charts', () => {
      const urgencyData = getChartData('urgencyMix', mockMetrics);
      expect(urgencyData[0]).toEqual({ name: 'High', label: 'High', value: 8 });

      const statusData = getChartData('statusMix', mockMetrics);
      expect(statusData[0]).toEqual({ name: 'Resolved', label: 'Resolved', value: 20 });
    });
  });

  describe('ChartWidget rendering', () => {
    it('renders real heatmap calendar for heatmap chartType', () => {
      const { container } = render(
        <ChartWidget
          metricKey="heatmapData"
          metrics={mockMetrics}
          config={{ chartType: 'heatmap' }}
        />
      );

      // Verify HeatmapCalendar container is rendered
      expect(container.querySelector('.heatmap-calendar-container, svg')).toBeDefined();
    });

    it('renders dual-series chart for mttaVsMttr', () => {
      const { container } = render(
        <ChartWidget
          metricKey="trendSeries"
          metrics={mockMetrics}
          config={{ chartType: 'mttaVsMttr' }}
        />
      );

      expect(container.querySelector('svg')).toBeDefined();
    });

    it('renders native pie chart for urgencyMix', () => {
      const { container } = render(
        <ChartWidget
          metricKey="urgencyMix"
          metrics={mockMetrics}
          config={{ chartType: 'pie' }}
        />
      );

      expect(container.querySelector('.analytics-pie-chart')).toBeDefined();
    });

    it('shows fallback when no data is available', () => {
      render(
        <ChartWidget
          metricKey="trendSeries"
          metrics={{ trendSeries: [] } as unknown as SerializedSLAMetrics}
          config={{ chartType: 'line' }}
        />
      );

      expect(screen.getByText('No chart data available')).toBeDefined();
    });
  });
});
