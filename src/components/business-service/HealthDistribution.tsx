/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier), never request input */
import Link from 'next/link';
import type { BusinessServiceTier } from '@prisma/client';
import type { BsStatus } from '@/lib/business-services/contract';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { BS_STATUS_META, CRITICALITY_LABEL } from './HealthBadge';
import {
  DISTRIBUTION_STATUSES,
  catalogHref,
  isImpacted,
  type CatalogQuery,
  type Distribution,
} from './catalog-model';

const FOCUS =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';

/**
 * Health at a glance: a proportional bar and a tier-by-status matrix whose cells filter the catalog
 * (keeping the current search, team and other filters). The health chips live in the filter bar, so
 * there is one health filter. With nothing impacted the matrix folds away behind a disclosure.
 * Colour is never the only signal: the bar has a text alternative and every cell its count.
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
  const impacted = DISTRIBUTION_STATUSES.some(status => isImpacted(status) && shown(status));
  const summary = statuses
    .filter(shown)
    .map(status => `${data.byStatus[status]} ${BS_STATUS_META[status].label.toLowerCase()}`)
    .join(', ');
  const cellHref = (status: BsStatus, tier: BusinessServiceTier | null) =>
    catalogHref(
      tier ? { ...query, status, tier } : { ...query, status, tier: '', needs: 'no-tier' }
    );
  const matrix = (
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
                      <span className="text-muted-foreground">
                        <span aria-hidden="true">–</span>
                        <span className="sr-only">none</span>
                      </span>
                    ) : (
                      <Link
                        href={cellHref(status, row.tier)}
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
  );
  return (
    <section
      aria-label="Health distribution"
      className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <p className="font-medium text-foreground">
          {impacted ? summary : `All ${data.total.toLocaleString()} without impact`}
        </p>
      </div>
      <div
        role="img"
        aria-label={summary}
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
      {impacted ? (
        matrix
      ) : (
        <details className="group text-xs">
          <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
            By tier and health
          </summary>
          <div className="pt-2">{matrix}</div>
        </details>
      )}
    </section>
  );
}
