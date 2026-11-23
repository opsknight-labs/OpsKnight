'use client';

import { memo, useId } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SquireChart as SquireChartData } from '@/lib/intelligence/squire/contract';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

// One teal family (blue, amber and red mean status); each series also gets its own dash, so none is told
// apart by colour alone.
const SERIES = [
  { color: 'var(--chart-series-1)', dash: undefined },
  { color: 'var(--chart-series-2)', dash: '6 3' },
  { color: 'var(--chart-ordinal-1)', dash: '2 3' },
  { color: 'var(--chart-ordinal-2)', dash: '8 3 2 3' },
] as const;
const AXIS = { fontSize: 11, fill: 'hsl(var(--ui-muted-foreground))' };

// The user's configured zone, not the browser's, so server and client render the same text.
const clock = (ms: number, timeZone: string) =>
  formatDateTime(new Date(ms), timeZone, { format: 'time' });
const stamp = (ms: number, timeZone: string) =>
  formatDateTime(new Date(ms), timeZone, { format: 'short' });
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** One sentence per series (first, last, lowest, highest), for screen readers and the figure's description. */
export function describeChart(chart: SquireChartData, timeZone = 'UTC'): string {
  const unit = chart.unit ? ` ${chart.unit}` : '';
  const all = chart.series.flatMap(series => series.points.map(point => Date.parse(point.t)));
  const span = `from ${stamp(Math.min(...all), timeZone)} to ${stamp(Math.max(...all), timeZone)}`;
  const lines = chart.series.map(series => {
    const values = series.points.map(point => point.v);
    return `${series.name}: ${number(values[0])}${unit} to ${number(values[values.length - 1])}${unit}, lowest ${number(Math.min(...values))}${unit}, highest ${number(Math.max(...values))}${unit}.`;
  });
  return `Line chart, ${chart.series.length} series ${span}. ${lines.join(' ')}`;
}

/**
 * A chart of the time series an answer read. The drawing is decorative for assistive technology: the figure
 * is focusable and described in words, and every value is in a visually hidden table.
 */
export default memo(function SquireChart({ chart }: { chart: SquireChartData }) {
  const id = useId();
  const { userTimeZone } = useTimezone();
  const unit = chart.unit ? ` ${chart.unit}` : '';
  const series = chart.series.map((item, index) => ({
    ...item,
    style: SERIES[index % SERIES.length],
    data: item.points.map(point => ({ ms: Date.parse(point.t), v: point.v })),
  }));
  return (
    <figure
      tabIndex={0}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="min-w-0 rounded-lg border border-border bg-card p-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <figcaption className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span id={`${id}-title`} className="min-w-0 truncate font-mono text-xs font-medium">
          {chart.title}
        </span>
        {chart.source?.label && (
          <span className="text-2xs text-muted-foreground">From {chart.source.label}</span>
        )}
      </figcaption>
      <p id={`${id}-description`} className="sr-only">
        {describeChart(chart, userTimeZone)}
      </p>
      <div className="h-40 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="ms"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={value => clock(Number(value), userTimeZone)}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              allowDuplicatedCategory={false}
            />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={value => `${number(Number(value))}${unit}`}
            />
            <Tooltip
              labelFormatter={value => stamp(Number(value), userTimeZone)}
              formatter={value => `${number(Number(value))}${unit}`}
              contentStyle={{
                background: 'hsl(var(--ui-popover))',
                color: 'hsl(var(--ui-popover-foreground))',
                border: '1px solid hsl(var(--ui-border))',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            {series.map((item, index) => (
              <Line
                key={index}
                data={item.data}
                dataKey="v"
                name={item.name}
                type="monotone"
                stroke={item.style.color}
                strokeDasharray={item.style.dash}
                strokeWidth={2}
                dot={item.data.length <= 12}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul
        aria-hidden="true"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        {series.map((item, index) => (
          <li key={index} className="flex min-w-0 items-center gap-1.5">
            <svg width="16" height="4" className="shrink-0">
              <line
                x1="0"
                y1="2"
                x2="16"
                y2="2"
                stroke={item.style.color}
                strokeWidth="2"
                strokeDasharray={item.style.dash}
              />
            </svg>
            <span className="truncate">{item.name}</span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{`${chart.title}: every value`}</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col">Time</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((item, index) =>
            item.data.map((point, position) => (
              <tr key={`${index}-${position}`}>
                <td>{item.name}</td>
                <td>{stamp(point.ms, userTimeZone)}</td>
                <td>{`${number(point.v)}${unit}`}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </figure>
  );
});
