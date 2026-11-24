/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier), never request input */
import Link from 'next/link';
import type { BsStatus } from '@/lib/business-services/contract';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { BS_STATUS_META, CRITICALITY_LABEL } from './HealthBadge';
import {
  DISTRIBUTION_STATUSES,
  catalogHref,
  type CatalogQuery,
  type Distribution,
} from './catalog-model';

const BASE: CatalogQuery = { q: '', tier: '', status: '', team: '', needs: '' };
const FOCUS =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';

/**
 * Health at a glance: a proportional bar, one count chip per status (each a filter link) and a
 * tier-by-status matrix. Colour is never the only signal: every chip and cell carries its label and count.
 */
export default function HealthDistribution({
  data,
  query,
}: {
  data: Distribution;
  query: CatalogQuery;
}) {
  if (data.total === 0) return null;
  const statuses = DISTRIBUTION_STATUSES.filter(
    status => data.byStatus[status] > 0 || status === 'OPERATIONAL'
  );
  const shown = (status: BsStatus) => data.byStatus[status] > 0;
  return (
    <section
      aria-label="Health distribution"
      className="space-y-4 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5"
    >
      <div
        role="img"
        aria-label={statuses
          .filter(shown)
          .map(status => `${data.byStatus[status]} ${BS_STATUS_META[status].label.toLowerCase()}`)
          .join(', ')}
        className="flex h-2 overflow-hidden rounded-full bg-muted"
      >
        {statuses.filter(shown).map(status => (
          <span
            key={status}
            className={toneClasses(BS_STATUS_META[status].tone).solid}
            style={{ width: `${(data.byStatus[status] / data.total) * 100}%` }}
          />
        ))}
      </div>

      <ul aria-label="Filter by health" className="flex flex-wrap gap-2">
        {statuses.map(status => {
          const meta = BS_STATUS_META[status];
          const Icon = meta.icon;
          const active = query.status === status && !query.tier && !query.needs;
          return (
            <li key={status}>
              <Link
                href={catalogHref({ ...BASE, status })}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  FOCUS,
                  active
                    ? toneClasses(meta.tone).filled
                    : cn(toneClasses(meta.tone).soft, 'hover:brightness-95')
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {meta.label}{' '}
                <span className="font-semibold tabular-nums">{data.byStatus[status]}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-xs">
          <caption className="pb-2 text-left font-medium text-muted-foreground">
            Business services by tier and health
          </caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="whitespace-nowrap py-1 pr-3 text-left font-medium">
                Tier
              </th>
              {statuses.map(status => (
                <th
                  key={status}
                  scope="col"
                  className="whitespace-nowrap px-2 py-1 text-right font-medium"
                >
                  {BS_STATUS_META[status].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.map(row => (
              <tr key={row.tier ?? 'none'} className="border-t">
                <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-medium">
                  {row.tier ? CRITICALITY_LABEL[row.tier] : 'No tier'}
                </th>
                {statuses.map(status => {
                  const count = row.byStatus[status];
                  const tone = toneClasses(BS_STATUS_META[status].tone);
                  return (
                    <td key={status} className="px-2 py-1 text-right tabular-nums">
                      {count === 0 ? (
                        <span className="text-muted-foreground" aria-label="none">
                          –
                        </span>
                      ) : (
                        <Link
                          href={catalogHref(
                            row.tier
                              ? { ...BASE, status, tier: row.tier }
                              : { ...BASE, status, needs: 'no-tier' }
                          )}
                          aria-label={`${count} ${row.tier ? CRITICALITY_LABEL[row.tier] : 'no tier'}, ${BS_STATUS_META[status].label.toLowerCase()}`}
                          className={cn(
                            'inline-flex min-w-7 justify-center rounded-md border px-1.5 py-0.5 font-semibold',
                            FOCUS,
                            status === 'OPERATIONAL' ? 'text-muted-foreground' : tone.soft
                          )}
                        >
                          {count}
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
