'use client';

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartFrame from '@/components/analytics/ChartFrame';
import type { SloBurnHistory } from '@/lib/slo/burn-alerts/contract';

const AXIS = { fontSize: 11, fill: 'hsl(var(--ui-muted-foreground))' };
const SLI_COLOR = 'var(--chart-series-1)';
const BURN_COLOR = 'var(--chart-series-2)';
const THRESHOLD_COLOR = 'hsl(var(--ui-muted-foreground))';

const clock = (iso: string) => iso.slice(11, 16);
const stamp = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC`;
const formatBurn = (value: number | null) => (value === null ? '—' : `${value}×`);
const formatSli = (value: number | null) => (value === null ? 'No events' : `${value}%`);

/**
 * SLI per 5-minute step and burn over the trailing hour, with the one-hour page threshold as a dashed line and the
 * alert transitions listed underneath. Every value is also in the table view.
 */
export default function SloBurnChart({ history, name }: { history: SloBurnHistory; name: string }) {
  // The burn line is the trailing hour, so only a tier measured over one hour can be drawn against it.
  const thresholds = [
    ...new Set(history.tiers.filter(tier => tier.long === '1h').map(tier => tier.threshold)),
  ];
  const points = history.points.map(point => ({ ...point, label: point.at }));
  const legend = [
    { key: 'sli', label: 'SLI (%)', color: SLI_COLOR },
    { key: 'burn', label: 'Burn, trailing hour (×)', color: BURN_COLOR },
  ];
  const chart =
    points.length === 0 ? (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No measurements stored yet. The first evaluation backfills up to three days.
      </p>
    ) : (
      <div>
        <div style={{ height: 220 }} aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tickFormatter={clock}
                tick={AXIS}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                yAxisId="burn"
                tick={AXIS}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={value => `${value}×`}
              />
              <YAxis
                yAxisId="sli"
                orientation="right"
                domain={['auto', 100]}
                tick={AXIS}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={value => `${value}%`}
              />
              {thresholds.map(value => (
                <ReferenceLine
                  key={value}
                  yAxisId="burn"
                  y={value}
                  stroke={THRESHOLD_COLOR}
                  strokeDasharray="4 4"
                  ifOverflow="hidden"
                />
              ))}
              <Tooltip
                cursor={{ stroke: THRESHOLD_COLOR, strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof points)[number];
                  return (
                    <div className="min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                      <p className="mb-1 font-medium">{stamp(row.at)}</p>
                      <p className="flex justify-between gap-4 tabular-nums">
                        <span className="text-muted-foreground">SLI</span>
                        {formatSli(row.sli)}
                      </p>
                      <p className="flex justify-between gap-4 tabular-nums">
                        <span className="text-muted-foreground">Burn, 1h</span>
                        {formatBurn(row.burn1h)}
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                yAxisId="sli"
                type="monotone"
                dataKey="sli"
                stroke={SLI_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="burn"
                type="monotone"
                dataKey="burn1h"
                stroke={BURN_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map(item => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="w-3 border-t-2 border-dashed"
              style={{ borderColor: THRESHOLD_COLOR }}
            />
            Page threshold over one hour ({thresholds.map(value => `${value}×`).join(', ')})
          </li>
        </ul>
      </div>
    );
  const table = (
    <table className="w-full text-xs">
      <caption className="sr-only">{`${name}: SLI and burn per 5-minute step`}</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 font-medium">
            Step (UTC)
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            SLI
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Burn, 1h
          </th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {[...points].reverse().map(point => (
          <tr key={point.at} className="border-t border-border">
            <td className="py-1">{stamp(point.at)}</td>
            <td className="py-1 text-right">{formatSli(point.sli)}</td>
            <td className="py-1 text-right">{formatBurn(point.burn1h)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-3">
      <ChartFrame label={`${name} burn`} chart={chart} table={table} />
      {history.transitions.length > 0 && (
        <ol aria-label="Alert transitions" className="space-y-1 text-xs">
          {[...history.transitions].reverse().map(item => (
            <li key={`${item.at}-${item.to}`} className="flex flex-wrap gap-x-2 tabular-nums">
              <span className="text-muted-foreground">{stamp(item.at)}</span>
              <span className="font-medium">
                {item.from} → {item.to}
              </span>
              <span className="text-muted-foreground">
                1h {formatBurn(item.burnByWindow['1h'])} · 6h {formatBurn(item.burnByWindow['6h'])}{' '}
                · 1d {formatBurn(item.burnByWindow['1d'])}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
