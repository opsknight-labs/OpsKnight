'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ServiceRow } from '@/lib/analytics/queries';
import type { MetricUnit } from '@/lib/analytics/definitions';
import { cn } from '@/lib/utils';
import { describeDelta, formatMetric } from './format';
import DeltaBadge from './DeltaBadge';
import IncidentDrillSheet from './IncidentDrillSheet';

type Column = {
  key: keyof ServiceRow | 'alertsPerIncident';
  label: string;
  unit: MetricUnit;
};

const COLUMNS: Column[] = [
  { key: 'incidents', label: 'Incidents', unit: 'count' },
  { key: 'mttaP50', label: 'MTTA', unit: 'duration' },
  { key: 'mttrP50', label: 'MTTR', unit: 'duration' },
  { key: 'mttrP90', label: 'MTTR p90', unit: 'duration' },
  { key: 'ackSla', label: 'Ack SLA', unit: 'percent' },
  { key: 'resolveSla', label: 'Resolve SLA', unit: 'percent' },
  { key: 'alertsPerIncident', label: 'Alerts / inc.', unit: 'ratio' },
];

const PAGE = 10;

const value = (row: ServiceRow, key: Column['key']): number | null =>
  key === 'alertsPerIncident'
    ? row.incidents > 0
      ? row.alerts / row.incidents
      : null
    : (row[key as keyof ServiceRow] as number | null);

export default function ServicesTable({ rows, compare }: { rows: ServiceRow[]; compare: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sort, setSort] = useState<{ key: Column['key']; desc: boolean }>({
    key: 'incidents',
    desc: true,
  });
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const direction = sort.desc ? -1 : 1;
    // No-data rows always sort last, whichever direction.
    return [...rows].sort((a, b) => {
      const av = value(a, sort.key);
      const bv = value(b, sort.key);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * direction || a.name.localeCompare(b.name);
    });
  }, [rows, sort]);
  const visible = expanded ? sorted : sorted.slice(0, PAGE);

  const filterHref = (serviceId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('service');
    params.set('service', serviceId);
    return `${pathname}?${params.toString()}`;
  };

  const toggleSort = (key: Column['key']) =>
    setSort(current => ({ key, desc: current.key === key ? !current.desc : true }));

  // The count opens the incidents behind it; the name link filters the page instead.
  const drill = (row: ServiceRow, className?: string) => (
    <IncidentDrillSheet
      drill="all"
      serviceId={row.id}
      title={`Incidents on ${row.name}`}
      label={`Show ${row.incidents} incidents on ${row.name}`}
      className={cn('tabular-nums underline decoration-dotted underline-offset-4', className)}
    >
      {formatMetric(row.incidents, 'count')}
    </IncidentDrillSheet>
  );

  const delta = (row: ServiceRow) =>
    compare ? describeDelta(row.incidents, row.previousIncidents, 'count', 'down') : null;

  return (
    <div>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Service reliability for the selected period</caption>
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Service
              </th>
              {COLUMNS.map(column => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                    className="whitespace-nowrap px-2 py-2 text-right font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active && 'text-foreground'
                      )}
                    >
                      {column.label}
                      {active &&
                        (sort.desc ? (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                <th scope="row" className="max-w-56 py-2.5 pr-3 text-left font-medium">
                  <Link
                    href={filterHref(row.id)}
                    scroll={false}
                    title={`Filter analytics to ${row.name}`}
                    className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.name}
                  </Link>
                </th>
                {COLUMNS.map(column => (
                  <td
                    key={column.key}
                    className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums"
                  >
                    {column.key === 'incidents' ? (
                      <span className="inline-flex items-center justify-end gap-2">
                        {drill(row)}
                        <DeltaBadge delta={delta(row)} compact />
                      </span>
                    ) : (
                      formatMetric(value(row, column.key), column.unit)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: a card list instead of a sideways-scrolling table */}
      <ul className="space-y-2 sm:hidden">
        {visible.map(row => (
          <li key={row.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={filterHref(row.id)}
                scroll={false}
                className="min-w-0 truncate text-sm font-medium hover:underline"
              >
                {row.name}
              </Link>
              <span className="inline-flex shrink-0 items-center gap-2 text-sm tabular-nums">
                {drill(row, 'inline-flex min-h-11 min-w-11 items-center justify-end')}
                <DeltaBadge delta={delta(row)} compact />
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {COLUMNS.slice(1).map(column => (
                <div key={column.key}>
                  <dt className="text-muted-foreground">{column.label}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatMetric(value(row, column.key), column.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {sorted.length > PAGE && (
        <button
          type="button"
          onClick={() => setExpanded(open => !open)}
          className="mt-3 h-9 rounded-md px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? 'Show fewer' : `Show all ${sorted.length} services`}
        </button>
      )}
    </div>
  );
}
