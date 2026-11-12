import LineChart from '@/components/analytics/LineChart';
import { STATUS_PALETTE } from '@/lib/design/status-palette';
import type { McpUsage } from '@/app/(app)/settings/integrations/mcp/usage';

const LINES = [
  { key: 'mcpCalls', label: 'Calls', color: STATUS_PALETTE.info.base },
  { key: 'mcpFailed', label: 'Failed', color: STATUS_PALETTE.critical.base },
];

/** UTC, like the custom range: a bucket label never shifts with the browser's zone. */
export function usageBucketLabel(at: string, bucket: McpUsage['bucket']) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(bucket === 'hour' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).format(new Date(at));
}

/**
 * Calls and failures over the period, drawn with the analytics LineChart. The analytics stylesheet
 * is route-scoped, so the few rules the chart relies on are given here with Tailwind.
 */
export default function McpUsageChart({ series, bucket }: Pick<McpUsage, 'series' | 'bucket'>) {
  const calls = series.reduce((sum, point) => sum + point.calls, 0);
  const failed = series.reduce((sum, point) => sum + point.failed, 0);
  const busiest = series.reduce<McpUsage['series'][number] | null>(
    (top, point) => (point.calls > (top?.calls ?? 0) ? point : top),
    null
  );
  const first = series.at(0);
  const last = series.at(-1);
  const summary =
    first && last
      ? `${calls.toLocaleString()} calls and ${failed.toLocaleString()} failed per ${bucket}, ${usageBucketLabel(first.at, bucket)} to ${usageBucketLabel(last.at, bucket)} (UTC)${
          busiest
            ? `. Busiest ${bucket}: ${usageBucketLabel(busiest.at, bucket)} with ${busiest.calls.toLocaleString()} calls`
            : ''
        }.`
      : 'No data.';

  return (
    <figure className="min-w-0 space-y-2" aria-labelledby="mcp-usage-chart-title">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span id="mcp-usage-chart-title" className="font-display text-sm font-semibold">
          Calls over time
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          {LINES.map(line => (
            <span key={line.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: line.color }} />
              {line.label}
            </span>
          ))}
        </span>
      </figcaption>
      <p className="sr-only">{summary}</p>
      <div
        aria-hidden="true"
        className="text-muted-foreground [&_.analytics-line-chart-axis]:mt-1 [&_.analytics-line-chart-axis]:flex [&_.analytics-line-chart-axis]:justify-between [&_.analytics-line-chart-axis]:text-[11px] [&_.analytics-line-chart-surface]:rounded-lg [&_.analytics-line-chart-surface]:border [&_.analytics-line-chart-surface]:border-border [&_.analytics-line-chart-surface]:bg-muted/30 [&_.analytics-line-chart-surface]:px-3 [&_.analytics-line-chart-surface]:pb-6 [&_.analytics-line-chart-surface]:pt-2 [&_.analytics-line-chart-surface]:relative [&_.analytics-line-chart-axis]:absolute [&_.analytics-line-chart-axis]:inset-x-3 [&_.analytics-line-chart-axis]:bottom-1"
      >
        <LineChart
          height={180}
          lines={LINES}
          data={series.map(point => ({
            label: usageBucketLabel(point.at, bucket),
            mcpCalls: point.calls,
            mcpFailed: point.failed,
          }))}
        />
      </div>
    </figure>
  );
}
