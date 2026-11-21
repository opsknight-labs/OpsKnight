'use client';

import { useState } from 'react';
import ChartFrame, { segmentClass } from '@/components/analytics/ChartFrame';
import { DurationComparisonChart } from '@/components/analytics/LazyTrendCharts';
import MetricInfo from '@/components/analytics/MetricInfo';
import { SectionCard } from '@/components/analytics/SectionCard';
import { formatBucket, formatDuration } from '@/components/analytics/format';
import type { DurationComparisonPoint } from '@/components/analytics/TrendCharts';
import type { OverviewOutcomes } from '@/lib/intelligence/overview/outcomes';
import { overviewWindowSpec, type OverviewWindowKey } from '@/lib/intelligence/overview/window';
import { DrilldownLink } from './primitives';

const ms = (seconds: number | null) => (seconds === null ? null : seconds * 1000);

const MEASURES = [
  {
    key: 'mtta',
    short: 'MTTA',
    field: 'mttaSeconds',
    title: 'Time to acknowledge',
    info: 'Mean time from creation to first acknowledgement, for incidents created in each period.',
  },
  {
    key: 'mttr',
    short: 'MTTR',
    field: 'mttrSeconds',
    title: 'Time to resolve',
    info: 'Mean time from creation to resolution, for incidents created in each period.',
  },
] as const;

/**
 * Bucket key in the Analytics chart format (wall clock, no zone). Overview buckets are UTC, so the key is
 * the UTC hour the bucket starts in.
 */
export function bucketKey(since: Date, bucketMs: number, index: number): string {
  return `${new Date(since.getTime() + index * bucketMs).toISOString().slice(0, 13)}:00:00`;
}

/**
 * MTTA or MTTR per period, this window against the previous one (dashed), in one Analytics-style trend
 * card: a measure picker and the Chart/Table toggle share the toolbar, so one short chart shows at a time.
 */
export default function OutcomeTrends({
  data,
  windowKey,
  since,
  className,
}: {
  data: OverviewOutcomes;
  windowKey: OverviewWindowKey;
  since: Date;
  className?: string;
}) {
  const [active, setActive] = useState<(typeof MEASURES)[number]['key']>('mtta');
  const spec = overviewWindowSpec(windowKey);
  const bucket = spec.bucketMs < 86_400_000 ? 'hour' : 'day';
  const series = MEASURES.map(measure => {
    const rows: DurationComparisonPoint[] = data.series.map(point => ({
      bucket: bucketKey(since, spec.bucketMs, point.index),
      current: ms(point.current[measure.field]),
      previous: ms(point.previous[measure.field]),
    }));
    return {
      measure,
      rows,
      hasData: rows.some(row => row.current !== null || row.previous !== null),
    };
  });
  const shown = series.find(item => item.measure.key === active) ?? series[0];
  const { measure, rows } = shown;
  const none = (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No {measure.key === 'mtta' ? 'acknowledged' : 'resolved'} incidents in this window or the one
      before it.
    </p>
  );

  return (
    <SectionCard
      id="overview-trends"
      title="Response trend"
      description={`Mean per ${bucket === 'hour' ? 'hour (UTC)' : 'day'}, this window against the previous one`}
      info={
        <MetricInfo
          definitions={MEASURES.map(item => ({ label: item.title, description: item.info }))}
        />
      }
      actions={<DrilldownLink id="overview-trends" href="/insights" label="Open analytics" />}
      className={className}
    >
      {series.some(item => item.hasData) ? (
        <ChartFrame
          label={measure.title}
          leading={
            <div
              role="group"
              aria-label="Measure"
              className="inline-flex rounded-md bg-muted p-0.5"
            >
              {series.map(({ measure: option }) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={option.key === measure.key}
                  title={option.title}
                  onClick={() => setActive(option.key)}
                  className={segmentClass(option.key === measure.key)}
                >
                  {option.short}
                </button>
              ))}
            </div>
          }
          chart={shown.hasData ? <DurationComparisonChart data={rows} bucket={bucket} /> : none}
          table={
            shown.hasData ? (
              <table className="w-full text-xs">
                <caption className="sr-only">
                  {measure.title} per period, this window and the previous one
                </caption>
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="py-1.5 text-left font-medium">
                      {bucket === 'hour' ? 'Hour (UTC)' : 'Day'}
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      This window
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Previous window
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.bucket} className="border-b last:border-0">
                      <th scope="row" className="py-1.5 text-left font-normal">
                        {formatBucket(row.bucket, 'day')}
                        {bucket === 'hour' ? ` ${formatBucket(row.bucket, 'hour')}` : ''}
                      </th>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatDuration(row.current)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatDuration(row.previous)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              none
            )
          }
        />
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No acknowledged or resolved incidents in this window or the one before it. Response times
          show here once incidents are acknowledged.
        </p>
      )}
    </SectionCard>
  );
}
