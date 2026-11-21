'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { InterruptionPoint, TrendPoint } from '@/lib/analytics/queries';
import { formatBucket, formatDuration } from './format';

type Bucket = 'hour' | 'day' | 'week' | 'month';

const AXIS = { fontSize: 11, fill: 'hsl(var(--ui-muted-foreground))' };
const HEIGHT = 240;

type Series = { key: string; label: string; color: string; dashed?: boolean };

/** Previous period: a dashed, muted line, so it reads as context rather than a series hue. */
const PREVIOUS_COLOR = 'hsl(var(--ui-muted-foreground))';
const previousSeries = (key: string, label = 'Previous period'): Series => ({
  key,
  label,
  color: PREVIOUS_COLOR,
  dashed: true,
});
const hasPrevious = (data: TrendPoint[]) => data.some(point => point.previousTotal !== undefined);

function Swatch({ item }: { item: Series }) {
  return item.dashed ? (
    <span
      aria-hidden
      className="w-3 border-t-2 border-dashed"
      style={{ borderColor: item.color }}
    />
  ) : (
    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: item.color }} />
  );
}

// A plain function, not a component: keeps <Line> a direct chart child.
function previousLine(item: Series) {
  return (
    <Line
      key={item.key}
      type="monotone"
      dataKey={item.key}
      stroke={item.color}
      strokeWidth={2}
      strokeDasharray="4 4"
      dot={false}
      activeDot={{ r: 3, strokeWidth: 0, fill: item.color }}
      connectNulls
      isAnimationActive={false}
    />
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  bucket,
  format,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: unknown;

  series: Series[];
  bucket: Bucket;
  format: (value: number | null) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Record<string, number | null>;
  return (
    <div className="min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">
        {bucket === 'week' ? 'Week of ' : ''}
        {formatBucket(String(label), bucket === 'hour' ? 'day' : bucket)}
        {bucket === 'hour' ? ` ${formatBucket(String(label), 'hour')}` : ''}
      </p>
      {[...series].reverse().map(item => (
        <p key={item.key} className="flex items-center justify-between gap-4 tabular-nums">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Swatch item={item} />
            {item.label}
          </span>
          <span className="font-medium">{format(row[item.key] ?? null)}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map(item => (
        <li key={item.key} className="flex items-center gap-1.5">
          <Swatch item={item} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

const URGENCY_SERIES: Series[] = [
  { key: 'low', label: 'Low', color: 'var(--chart-ordinal-1)' },
  { key: 'medium', label: 'Medium', color: 'var(--chart-ordinal-2)' },
  { key: 'high', label: 'High', color: 'var(--chart-ordinal-3)' },
];

export function VolumeChart({ data, bucket }: { data: TrendPoint[]; bucket: Bucket }) {
  const previous = hasPrevious(data) ? previousSeries('previousTotal') : null;
  // Tooltip lists series top-down (reversed), so the previous line goes first to land last.
  const tooltipSeries = previous ? [previous, ...URGENCY_SERIES] : URGENCY_SERIES;
  return (
    <div>
      <div style={{ height: HEIGHT }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
            barCategoryGap="20%"
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="bucket"
              tickFormatter={value => formatBucket(value, bucket)}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--ui-muted))', opacity: 0.5 }}
              content={props => (
                <ChartTooltip
                  {...props}
                  series={tooltipSeries}
                  bucket={bucket}
                  format={value => String(value ?? 0)}
                />
              )}
            />
            {URGENCY_SERIES.map((series, index) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                stackId="urgency"
                fill={series.color}
                stroke="hsl(var(--ui-card))"
                strokeWidth={1}
                radius={index === URGENCY_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
            {previous && previousLine(previous)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend series={previous ? [...URGENCY_SERIES, previous] : URGENCY_SERIES} />
    </div>
  );
}

const DURATION_SERIES = (prefix: 'mtta' | 'mttr'): Series[] => [
  { key: `${prefix}P50`, label: 'Median', color: 'var(--chart-series-1)' },
  { key: `${prefix}P90`, label: 'p90', color: 'var(--chart-series-2)' },
];

export function DurationChart({
  data,
  bucket,
  metric,
}: {
  data: TrendPoint[];
  bucket: Bucket;
  metric: 'mtta' | 'mttr';
}) {
  const series = DURATION_SERIES(metric);
  const previous = hasPrevious(data)
    ? previousSeries(metric === 'mtta' ? 'previousMttaP50' : 'previousMttrP50', 'Previous median')
    : null;
  return (
    <div>
      <div style={{ height: HEIGHT }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="bucket"
              tickFormatter={value => formatBucket(value, bucket)}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={value => formatDuration(value)}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              cursor={{ stroke: 'hsl(var(--ui-muted-foreground))', strokeDasharray: '3 3' }}
              content={props => (
                <ChartTooltip
                  {...props}
                  series={previous ? [previous, ...series] : series}
                  bucket={bucket}
                  format={formatDuration}
                />
              )}
            />
            {series.map(item => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={item.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--ui-card))' }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            {previous && previousLine(previous)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend series={previous ? [...series, previous] : series} />
    </div>
  );
}

// Same hues as the responder band legend, so evening/overnight read the same everywhere.
const INTERRUPTION_SERIES: Series[] = [
  { key: 'evening', label: 'Evenings & weekends', color: 'var(--chart-ordinal-2)' },
  { key: 'overnight', label: 'Overnight', color: 'var(--chart-ordinal-3)' },
];

export function InterruptionsChart({
  data,
  bucket,
}: {
  data: InterruptionPoint[];
  bucket: Bucket;
}) {
  return (
    <div>
      <div style={{ height: 180 }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="bucket"
              tickFormatter={value => formatBucket(value, bucket)}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: 'hsl(var(--ui-muted-foreground))', strokeDasharray: '3 3' }}
              content={props => (
                <ChartTooltip
                  {...props}
                  series={INTERRUPTION_SERIES}
                  bucket={bucket}
                  format={value => String(value ?? 0)}
                />
              )}
            />
            {INTERRUPTION_SERIES.map(item => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={item.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--ui-card))' }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend series={INTERRUPTION_SERIES} />
    </div>
  );
}
