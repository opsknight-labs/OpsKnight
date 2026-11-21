'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  DirectoryHeader,
  DirectoryTable,
  useDirectoryColumns,
  type DirectoryColumn,
} from '@/components/patterns/Directory';
import type { AlertListDecision, AlertListRow } from '@/lib/intelligence/lists/alerts';
import { NOISE_DECISION_TONE } from '@/lib/intelligence/incident-ux/explain';
import { ALERT_DECISION_LABELS, ALERT_SEVERITIES } from '@/lib/intelligence/lists/contract';
import {
  ListChip,
  ListWhen,
  ListWhenCell,
  listLinkClass,
  listSubLinkClass,
  type ChipTone,
} from './shared';

const SEVERITY_TONE: ReadonlyMap<string, ChipTone> = new Map([
  ['critical', 'critical'],
  ['error', 'elevated'],
  ['warning', 'elevated'],
  ['info', 'info'],
]);

export function SeverityChip({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const key = severity.toLowerCase();
  return (
    <ListChip tone={SEVERITY_TONE.get(key) ?? 'neutral'}>
      <span className="sr-only">Severity: </span>
      {key}
    </ListChip>
  );
}

/** What a noise control did with the alert. A shadow decision is marked as such and never coloured. */
export function DecisionChip({ decision }: { decision: AlertListDecision | null }) {
  if (!decision) return null;
  const label = ALERT_DECISION_LABELS[decision.kind];
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-0.5">
      <ListChip tone={decision.applied ? NOISE_DECISION_TONE[decision.kind] : 'outline'}>
        {decision.applied ? label : `Shadow: ${label.toLowerCase()}`}
      </ListChip>
      {decision.sourceName && (
        <span className="break-words text-xs text-muted-foreground">{decision.sourceName}</span>
      )}
    </span>
  );
}

const EMPTY_CELL = (
  <span className="text-muted-foreground">
    <span aria-hidden="true">—</span>
    <span className="sr-only">None</span>
  </span>
);

/** Labels shown inline before the rest are counted, so a row stays one or two lines tall. */
const SHOWN_LABELS = 2;

function Labels({ row }: { row: AlertListRow }) {
  if (row.labels.length === 0) return EMPTY_CELL;
  const more = Math.max(0, row.labels.length - SHOWN_LABELS) + row.moreLabels;
  return (
    <ul aria-label="Labels" className="flex flex-wrap items-center gap-1">
      {row.labels.slice(0, SHOWN_LABELS).map(label => (
        <li key={label.key} className="min-w-0 max-w-full" title={`${label.key}=${label.value}`}>
          <ListChip>
            <span className="truncate">
              {label.key}={label.value}
            </span>
          </ListChip>
        </li>
      ))}
      {more > 0 && <li className="whitespace-nowrap text-xs text-muted-foreground">+{more} more</li>}
    </ul>
  );
}

function IncidentLink({ row }: { row: AlertListRow }) {
  if (!row.incidentId) return null;
  return (
    <Link
      href={`/incidents/${encodeURIComponent(row.incidentId)}`}
      className={`flex min-h-11 w-fit items-center text-xs text-muted-foreground underline sm:min-h-0 ${listSubLinkClass}`}
    >
      Open incident
    </Link>
  );
}

const severityRank = (severity: string | null) => {
  const index = ALERT_SEVERITIES.findIndex(value => value === severity?.toLowerCase());
  return index === -1 ? null : ALERT_SEVERITIES.length - index;
};

const buildColumns = (timeZone: string): readonly DirectoryColumn<AlertListRow>[] => [
  {
    id: 'alert',
    header: 'Alert',
    sortKey: 'alert',
    sortValue: row => row.summary,
    className: 'min-w-[16rem]',
    cell: row => (
      <div className="min-w-0 py-0.5">
        <Link
          href={`/alerts/${encodeURIComponent(row.id)}`}
          className="line-clamp-2 break-words font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.summary}
        </Link>
        <IncidentLink row={row} />
      </div>
    ),
  },
  {
    id: 'service',
    header: 'Service',
    hideable: true,
    sortKey: 'service',
    sortValue: row => row.serviceName,
    className: 'w-40',
    cell: row => (
      <Link href={`/services/${encodeURIComponent(row.serviceId)}`} className={listSubLinkClass}>
        {row.serviceName}
      </Link>
    ),
  },
  {
    id: 'severity',
    header: 'Severity',
    hideable: true,
    sortKey: 'severity',
    sortValue: row => severityRank(row.severity),
    className: 'w-28',
    cell: row => (row.severity ? <SeverityChip severity={row.severity} /> : EMPTY_CELL),
  },
  {
    id: 'labels',
    header: 'Labels',
    hideable: true,
    className: 'hidden w-56 lg:table-cell',
    cell: row => <Labels row={row} />,
  },
  {
    id: 'decision',
    header: 'Noise decision',
    hideable: true,
    className: 'w-44',
    cell: row => (row.decision ? <DecisionChip decision={row.decision} /> : EMPTY_CELL),
  },
  {
    id: 'received',
    header: 'Received',
    hideable: true,
    sortKey: 'received',
    sortValue: row => row.receivedAt.getTime(),
    className: 'w-44',
    cell: row => <ListWhenCell value={row.receivedAt} timeZone={timeZone} />,
  },
];

/** Phone row: summary as a 44 px target, then service, severity, time, decision and the incident link. */
function mobileRow(row: AlertListRow, timeZone: string) {
  return (
    <div className="min-w-0 space-y-1">
      <Link href={`/alerts/${encodeURIComponent(row.id)}`} className={listLinkClass}>
        {row.summary}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="break-words">{row.serviceName}</span>
        <SeverityChip severity={row.severity} />
        <ListWhen value={row.receivedAt} timeZone={timeZone} />
      </div>
      <DecisionChip decision={row.decision} />
      <IncidentLink row={row} />
    </div>
  );
}

/**
 * The alerts list card: directory header (summary, columns, density), the table (stacked rows on phones)
 * and the page's footer. Sorting reorders the rows on this page; the server pages newest first.
 */
export default function AlertsTable({
  rows,
  timeZone,
  summary,
  notice,
  empty,
  footer,
}: {
  rows: readonly AlertListRow[];
  /** The viewer's time zone; times are shown labelled in it. */
  timeZone: string;
  summary?: ReactNode;
  /** A note above the rows (e.g. truncated filter options). */
  notice?: ReactNode;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const tableColumns = useMemo(() => buildColumns(timeZone), [timeZone]);
  const columns = useDirectoryColumns('alerts', tableColumns);
  return (
    <section
      aria-label="Alert list"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <DirectoryHeader title="Alert list" summary={summary} columns={columns} density />
      {notice}
      {rows.length === 0 && empty ? (
        empty
      ) : (
        <DirectoryTable
          rows={rows}
          getRowId={row => row.id}
          columns={tableColumns}
          hiddenColumns={columns.hidden}
          label="Alerts, newest first"
          mobileRow={row => mobileRow(row, timeZone)}
        />
      )}
      {footer}
    </section>
  );
}
