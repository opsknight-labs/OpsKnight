import type { ImpactReportRow } from '@/lib/business-services/impact-report';

export const hours = (value: number) => (value === 0 ? '0 h' : `${(value / 60).toFixed(1)} h`);

export default function ImpactBars({ rows }: { rows: ImpactReportRow[] }) {
  // The report may be sorted by cost or uptime; the bars always rank by impacted time.
  const top = rows
    .filter(row => row.stats.impactMinutes > 0)
    .sort((a, b) => b.stats.impactMinutes - a.stats.impactMinutes)
    .slice(0, 10);
  if (top.length === 0)
    return <p className="text-sm text-muted-foreground">No business service was impacted.</p>;
  const max = Math.max(...top.map(row => row.stats.impactMinutes));
  return (
    <ul className="space-y-2">
      {top.map(row => (
        <li
          key={row.id}
          className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm"
        >
          <span className="truncate" title={row.name}>
            {row.name}
          </span>
          <span className="h-2.5 rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-status-critical"
              style={{ width: `${Math.max((row.stats.impactMinutes / max) * 100, 2)}%` }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-muted-foreground">
            {hours(row.stats.impactMinutes)}
          </span>
        </li>
      ))}
    </ul>
  );
}
