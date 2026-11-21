import Link from 'next/link';
import type { AlertListDecision, AlertListRow } from '@/lib/intelligence/lists/alerts';
import { NOISE_DECISION_TONE } from '@/lib/intelligence/incident-ux/explain';
import { ALERT_DECISION_LABELS } from '@/lib/intelligence/lists/contract';
import {
  ListChip,
  ListWhen,
  listCellClass,
  listHeadClass,
  listLinkClass,
  type ChipTone,
} from './shared';

const SEVERITY_TONE: ReadonlyMap<string, ChipTone> = new Map([
  ['critical', 'critical'],
  ['error', 'elevated'],
  ['warning', 'elevated'],
  ['info', 'info'],
]);

const EMPTY_CELL = (
  <span className="text-muted-foreground">
    <span aria-hidden="true">—</span>
    <span className="sr-only">None</span>
  </span>
);

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
    <span className="inline-flex max-w-full flex-col gap-0.5">
      <ListChip tone={decision.applied ? NOISE_DECISION_TONE[decision.kind] : 'outline'}>
        {decision.applied ? label : `Shadow: ${label.toLowerCase()}`}
      </ListChip>
      {decision.sourceName && (
        <span className="break-words text-xs text-muted-foreground">{decision.sourceName}</span>
      )}
    </span>
  );
}

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
      {more > 0 && (
        <li className="whitespace-nowrap text-xs text-muted-foreground">+{more} more</li>
      )}
    </ul>
  );
}

/**
 * The alerts list. One table at every width: on a phone the service, labels and decision fold under the
 * summary so each row stays a single 44 px-tall target, and the extra columns appear from `md` up.
 */
export default function AlertsTable({
  rows,
  timeZone,
}: {
  rows: readonly AlertListRow[];
  timeZone: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed border-collapse" data-testid="alerts-table">
        <caption className="sr-only">Alerts, newest first</caption>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={listHeadClass}>
              Alert
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-40 md:table-cell`}>
              Service
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-28 md:table-cell`}>
              Severity
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-56 lg:table-cell`}>
              Labels
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-44 md:table-cell`}>
              Noise decision
            </th>
            <th scope="col" className={`${listHeadClass} hidden w-44 md:table-cell`}>
              Received
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.id} data-alert-row={row.id}>
              <td className={listCellClass}>
                <Link href={`/alerts/${encodeURIComponent(row.id)}`} className={listLinkClass}>
                  {row.summary}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                  <span className="break-words">{row.serviceName}</span>
                  <SeverityChip severity={row.severity} />
                  <ListWhen value={row.receivedAt} timeZone={timeZone} />
                </div>
                <div className="mt-1 space-y-1 md:hidden">
                  <DecisionChip decision={row.decision} />
                </div>
                {row.incidentId && (
                  <Link
                    href={`/incidents/${encodeURIComponent(row.incidentId)}`}
                    className="mt-1 flex min-h-11 w-fit items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                  >
                    Open incident
                  </Link>
                )}
              </td>
              <td className={`${listCellClass} hidden md:table-cell`}>
                <Link
                  href={`/services/${encodeURIComponent(row.serviceId)}`}
                  className="break-words underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.serviceName}
                </Link>
              </td>
              <td className={`${listCellClass} hidden md:table-cell`}>
                {row.severity ? <SeverityChip severity={row.severity} /> : EMPTY_CELL}
              </td>
              <td className={`${listCellClass} hidden lg:table-cell`}>
                <Labels row={row} />
              </td>
              <td className={`${listCellClass} hidden md:table-cell`}>
                {row.decision ? <DecisionChip decision={row.decision} /> : EMPTY_CELL}
              </td>
              <td className={`${listCellClass} hidden text-muted-foreground md:table-cell`}>
                <ListWhen value={row.receivedAt} timeZone={timeZone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
