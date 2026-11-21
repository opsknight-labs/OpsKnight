import Link from 'next/link';
import type { ChangeListRow } from '@/lib/intelligence/lists/changes';
import { RiskMeter } from '@/components/intelligence/overview/ChangePanel';
import { ListChip, ListWhen, listCellClass, listHeadClass, listLinkClass } from './shared';

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
            className="inline-flex min-h-11 items-center break-words text-xs underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
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

/**
 * The changes list. One table at every width: on a phone the source, service, risk and linked incidents
 * fold under the summary, and the extra columns appear from `md` up. Risk is a ranking signal, so its
 * band label always accompanies the colour.
 */
export default function ChangesTable({ rows }: { rows: readonly ChangeListRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed border-collapse" data-testid="changes-table">
        <caption className="sr-only">Changes, newest first</caption>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={listHeadClass}>
              Change
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-36 md:table-cell`}>
              Source
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-40 md:table-cell`}>
              Service
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-48 md:table-cell`}>
              Risk
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-56 lg:table-cell`}>
              Linked incidents
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-44 md:table-cell`}>
              Time
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.id} data-change-row={row.id}>
              <td className={listCellClass}>
                <Link href={`/changes/${encodeURIComponent(row.id)}`} className={listLinkClass}>
                  {row.summary}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <ListChip>{kindLabel(row.kind)}</ListChip>
                  {row.version && <span className="break-all">{row.version}</span>}
                  <span className="md:hidden">{row.source}</span>
                  <span className="break-words md:hidden">{row.serviceName ?? 'No service'}</span>
                  <span className="md:hidden">
                    <ListWhen value={row.occurredAt} />
                  </span>
                </div>
                <div className="mt-1 space-y-1 md:hidden">
                  <Risk score={row.riskScore} />
                </div>
                <div className="mt-1 lg:hidden">
                  <LinkedIncidents row={row} />
                </div>
              </td>
              <td className={`${listCellClass} hidden break-words md:table-cell`}>{row.source}</td>
              <td className={`${listCellClass} hidden md:table-cell`}>
                {row.serviceId ? (
                  <Link
                    href={`/services/${encodeURIComponent(row.serviceId)}`}
                    className="break-words underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.serviceName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No service</span>
                )}
              </td>
              <td className={`${listCellClass} hidden md:table-cell`}>
                <Risk score={row.riskScore} />
              </td>
              <td className={`${listCellClass} hidden lg:table-cell`}>
                <LinkedIncidents row={row} />
              </td>
              <td className={`${listCellClass} hidden text-muted-foreground md:table-cell`}>
                <ListWhen value={row.occurredAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
