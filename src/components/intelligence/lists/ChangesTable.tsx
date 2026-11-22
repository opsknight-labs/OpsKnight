'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  DirectoryHeader,
  DirectoryTable,
  useDirectoryColumns,
  type DirectoryColumn,
} from '@/components/patterns/Directory';
import type { ChangeListRow } from '@/lib/intelligence/lists/changes';
import { RiskMeter } from '@/components/intelligence/overview/ChangePanel';
import { ListChip, ListWhen, ListWhenCell, listLinkClass, listSubLinkClass } from './shared';

const kindLabel = (kind: string) => kind.toLowerCase().replace(/_/g, ' ');

function Risk({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Not scored</span>;
  return <RiskMeter score={score} />;
}

function LinkedIncidents({ row }: { row: ChangeListRow }) {
  if (row.linkedIncidentCount === 0) return null;
  return (
    <ul aria-label="Linked incidents" className="space-y-0.5">
      {row.linkedIncidents.map(incident => (
        <li key={incident.id}>
          <Link
            href={`/incidents/${encodeURIComponent(incident.id)}`}
            className={`inline-flex min-h-11 items-center text-xs underline sm:min-h-0 ${listSubLinkClass}`}
          >
            {incident.title}
          </Link>
        </li>
      ))}
      {row.linkedIncidentCount > row.linkedIncidents.length && (
        <li className="text-xs text-muted-foreground">
          +{row.linkedIncidentCount - row.linkedIncidents.length} more
        </li>
      )}
    </ul>
  );
}

function ServiceCell({ row }: { row: ChangeListRow }) {
  return row.serviceId ? (
    <Link href={`/services/${encodeURIComponent(row.serviceId)}`} className={listSubLinkClass}>
      {row.serviceName}
    </Link>
  ) : (
    <span className="text-muted-foreground">No service</span>
  );
}

const buildColumns = (timeZone: string): readonly DirectoryColumn<ChangeListRow>[] => [
  {
    id: 'change',
    header: 'Change',
    sortKey: 'change',
    sortValue: row => row.summary,
    className: 'min-w-[16rem]',
    cell: row => (
      <div className="min-w-0 space-y-1 py-0.5">
        <Link
          href={`/changes/${encodeURIComponent(row.id)}`}
          className="line-clamp-2 wrap-break-word font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.summary}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <ListChip>{kindLabel(row.kind)}</ListChip>
          {row.version && <span className="break-all font-mono">{row.version}</span>}
        </div>
      </div>
    ),
  },
  {
    id: 'source',
    header: 'Source',
    hideable: true,
    sortKey: 'source',
    sortValue: row => row.source,
    className: 'w-36 wrap-break-word',
    cell: row => row.source,
  },
  {
    id: 'service',
    header: 'Service',
    hideable: true,
    sortKey: 'service',
    sortValue: row => row.serviceName,
    className: 'w-40',
    cell: row => <ServiceCell row={row} />,
  },
  {
    id: 'risk',
    header: 'Risk',
    hideable: true,
    sortKey: 'risk',
    sortValue: row => row.riskScore,
    className: 'w-48',
    cell: row => <Risk score={row.riskScore} />,
  },
  {
    id: 'incidents',
    header: 'Linked incidents',
    hideable: true,
    className: 'hidden w-56 lg:table-cell',
    cell: row => <LinkedIncidents row={row} />,
  },
  {
    id: 'time',
    header: 'Time',
    hideable: true,
    sortKey: 'time',
    sortValue: row => row.occurredAt.getTime(),
    className: 'w-44',
    cell: row => <ListWhenCell value={row.occurredAt} timeZone={timeZone} />,
  },
];

/** Phone row: summary as a 44 px target, then kind, source, service, time, risk and linked incidents. */
function mobileRow(row: ChangeListRow, timeZone: string) {
  return (
    <div className="min-w-0 space-y-1">
      <Link href={`/changes/${encodeURIComponent(row.id)}`} className={listLinkClass}>
        {row.summary}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ListChip>{kindLabel(row.kind)}</ListChip>
        {row.version && <span className="break-all">{row.version}</span>}
        <span>{row.source}</span>
        <span className="wrap-break-word">{row.serviceName ?? 'No service'}</span>
        <ListWhen value={row.occurredAt} timeZone={timeZone} />
      </div>
      <Risk score={row.riskScore} />
      <LinkedIncidents row={row} />
    </div>
  );
}

/**
 * The changes list card: directory header (summary, columns, density), the table (stacked rows on phones)
 * and the page's footer. Risk is a ranking signal, so its band label always accompanies the colour.
 * Sorting reorders the rows on this page; the server pages newest first.
 */
export default function ChangesTable({
  rows,
  timeZone,
  summary,
  notice,
  empty,
  footer,
}: {
  rows: readonly ChangeListRow[];
  /** The viewer's time zone; times are shown labelled in it. */
  timeZone: string;
  summary?: ReactNode;
  notice?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const tableColumns = useMemo(() => buildColumns(timeZone), [timeZone]);
  const columns = useDirectoryColumns('changes', tableColumns);
  return (
    <section
      aria-label="Change list"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-xs"
    >
      <DirectoryHeader title="Change list" summary={summary} columns={columns} density />
      {notice}
      {rows.length === 0 && empty ? (
        empty
      ) : (
        <DirectoryTable
          rows={rows}
          getRowId={row => row.id}
          columns={tableColumns}
          hiddenColumns={columns.hidden}
          label="Changes, newest first"
          mobileRow={row => mobileRow(row, timeZone)}
        />
      )}
      {footer}
    </section>
  );
}
