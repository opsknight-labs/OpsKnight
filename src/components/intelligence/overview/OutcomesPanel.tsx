import LineChart from '@/components/analytics/LineChart';
import type { OverviewOutcomes } from '@/lib/intelligence/overview/outcomes';
import {
  formatCount,
  formatDuration,
  overviewWindowSpec,
  type OverviewWindowKey,
} from '@/lib/intelligence/overview/window';
import { OVERVIEW_CHART_VARS, relativeDelta, StatGrid, StatTile } from './primitives';

const minutes = (seconds: number | null) =>
  seconds === null ? null : Math.round((seconds / 60) * 10) / 10;

/** Bucket label of the selected window, in UTC so server and reader agree. */
export function bucketLabel(since: Date, bucketMs: number, index: number): string {
  const start = new Date(since.getTime() + index * bucketMs);
  if (bucketMs < 86_400_000) return `${start.toISOString().slice(11, 13)}:00 UTC`;
  return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function TrendChart({
  id,
  title,
  data,
  currentKey,
  previousKey,
}: {
  id: string;
  title: string;
  data: Array<Record<string, number | string | null>>;
  currentKey: string;
  previousKey: string;
}) {
  const hasData = data.some(row =>
    Object.entries(row).some(
      ([key, value]) => (key === currentKey || key === previousKey) && value !== null
    )
  );
  return (
    <figure className="min-w-0 space-y-2" aria-labelledby={`${id}-caption`}>
      <figcaption
        id={`${id}-caption`}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <span className="text-sm font-medium">{title}, minutes</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 rounded bg-[var(--overview-accent)]" /> This window
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 rounded bg-[var(--overview-context)]" /> Previous window
          </span>
        </span>
      </figcaption>
      {hasData ? (
        <div
          role="img"
          aria-label={`${title} per period, this window compared with the previous one. The data table below lists every value.`}
        >
          <LineChart
            data={data}
            height={160}
            lines={[
              { key: previousKey, color: 'var(--overview-context)', label: 'Previous window' },
              { key: currentKey, color: 'var(--overview-accent)', label: 'This window' },
            ]}
          />
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No acknowledged or resolved incidents yet.
        </p>
      )}
    </figure>
  );
}

export default function OutcomesPanel({
  data,
  windowKey,
  since,
}: {
  data: OverviewOutcomes;
  windowKey: OverviewWindowKey;
  since: Date;
}) {
  const spec = overviewWindowSpec(windowKey);
  const period = spec.short;
  const rows = data.series.map(bucket => ({
    label: bucketLabel(since, spec.bucketMs, bucket.index),
    mttaCurrent: minutes(bucket.current.mttaSeconds),
    mttaPrevious: minutes(bucket.previous.mttaSeconds),
    mttrCurrent: minutes(bucket.current.mttrSeconds),
    mttrPrevious: minutes(bucket.previous.mttrSeconds),
  }));
  return (
    <div className={`space-y-4 ${OVERVIEW_CHART_VARS}`}>
      <StatGrid label={`Outcomes, ${spec.label.toLowerCase()}`}>
        <StatTile
          label="Mean time to acknowledge"
          value={formatDuration(data.current.mttaSeconds)}
          delta={relativeDelta(data.current.mttaSeconds, data.previous.mttaSeconds, {
            lowerIsBetter: true,
            period,
          })}
          hint={`${formatCount(data.current.acknowledged)} acknowledged`}
        />
        <StatTile
          label="Mean time to resolve"
          value={formatDuration(data.current.mttrSeconds)}
          delta={relativeDelta(data.current.mttrSeconds, data.previous.mttrSeconds, {
            lowerIsBetter: true,
            period,
          })}
          hint={`${formatCount(data.current.resolved)} resolved`}
        />
        <StatTile
          label="Incidents"
          value={formatCount(data.current.incidents)}
          delta={(() => {
            const delta = relativeDelta(data.current.incidents, data.previous.incidents, {
              lowerIsBetter: true,
              period,
            });
            // Volume is context, not a goal: show the direction without judging it.
            return delta ? { ...delta, tone: 'neutral' as const } : null;
          })()}
          hint={`${formatCount(data.previous.incidents)} in the previous ${period}`}
        />
      </StatGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        <TrendChart
          id="overview-mtta"
          title="Mean time to acknowledge"
          data={rows}
          currentKey="mttaCurrent"
          previousKey="mttaPrevious"
        />
        <TrendChart
          id="overview-mttr"
          title="Mean time to resolve"
          data={rows}
          currentKey="mttrCurrent"
          previousKey="mttrPrevious"
        />
      </div>
      <details className="rounded-lg border border-border/70 p-3 text-sm">
        <summary className="min-h-11 cursor-pointer content-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">
          Show data table
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">
              Mean time to acknowledge and resolve per period, in minutes
            </caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="p-1.5 font-medium">
                  Period
                </th>
                <th scope="col" className="p-1.5 font-medium">
                  MTTA
                </th>
                <th scope="col" className="p-1.5 font-medium">
                  MTTA previous
                </th>
                <th scope="col" className="p-1.5 font-medium">
                  MTTR
                </th>
                <th scope="col" className="p-1.5 font-medium">
                  MTTR previous
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label} className="border-t border-border/60">
                  <th scope="row" className="p-1.5 font-normal">
                    {row.label}
                  </th>
                  <td className="p-1.5">{row.mttaCurrent ?? '—'}</td>
                  <td className="p-1.5">{row.mttaPrevious ?? '—'}</td>
                  <td className="p-1.5">{row.mttrCurrent ?? '—'}</td>
                  <td className="p-1.5">{row.mttrPrevious ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
