import 'server-only';

import { EmptyState } from '@/components/patterns';
import type { AnalyticsContext, AnalyticsSectionData } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { formatDuration, formatMetric } from './format';
import MetricInfo from './MetricInfo';
import { SectionCard } from './SectionCard';
import SectionError from './SectionError';
import { load } from './sections';

const VISIBLE = 10;

type Row = AnalyticsSectionData<'availability'>[number];

function uptimeLabel(value: number) {
  // Two decimals: 99.95% and 99.99% are very different budgets.
  return value >= 100 ? '100%' : `${(Math.floor(value * 100) / 100).toFixed(2)}%`;
}

function AvailabilityItem({ row }: { row: Row }) {
  const over = row.budgetRemaining !== null && row.budgetRemaining < 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-b py-2.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_9rem]">
      <span className="truncate text-sm font-medium" title={row.name}>
        {row.name}
      </span>
      <span className="text-right text-sm font-semibold tabular-nums">
        {uptimeLabel(row.uptime)}
        <span className="sr-only"> uptime</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums sm:text-right">
        {row.downtimeMs > 0 ? `${formatDuration(row.downtimeMs)} down` : 'No downtime'}
      </span>
      <span
        className={cn(
          'text-right text-xs tabular-nums',
          over ? 'font-medium text-destructive' : 'text-muted-foreground'
        )}
      >
        {row.objective === null || row.budgetRemaining === null
          ? 'No objective'
          : over
            ? `Over budget · target ${row.objective.target}%`
            : `${formatMetric(row.budgetRemaining, 'percent')} budget left · target ${row.objective.target}%`}
      </span>
    </li>
  );
}

export async function AvailabilitySection({ context }: { context: AnalyticsContext }) {
  const result = await load(context, 'availability');
  return (
    <SectionCard
      id="analytics-availability"
      title="Availability"
      description="Uptime per service in this period, worst first, against its uptime objective where one is set"
      info={<MetricInfo metrics={['uptime', 'errorBudgetRemaining']} />}
      className="xl:col-span-12"
    >
      {'error' in result ? (
        <SectionError title="Availability" errorCode={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          variant="simple"
          size="sm"
          title="No services in scope"
          description="Services you can access appear here. Clear the service or team filter, or ask an administrator for access."
        />
      ) : (
        <>
          <ul>
            {result.data.slice(0, VISIBLE).map(row => (
              <AvailabilityItem key={row.id} row={row} />
            ))}
          </ul>
          {result.data.length > VISIBLE && (
            <details className="group">
              <summary className="mt-2 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="group-open:hidden">Show all {result.data.length} services</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul>
                {result.data.slice(VISIBLE).map(row => (
                  <AvailabilityItem key={row.id} row={row} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </SectionCard>
  );
}
