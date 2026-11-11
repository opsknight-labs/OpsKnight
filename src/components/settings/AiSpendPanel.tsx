import Link from 'next/link';
import type { BudgetStatus, SpendBreakdown, SpendSlice } from '@/lib/intelligence/ai/cost';
import { formatUsd } from '@/lib/intelligence/ai/pricing';

/**
 * Spend by day, team, capability and model, plus today's budget utilisation. Dependency-free bars backed by
 * real tables (the same approach as AiUsageChart), so numbers are available to screen readers and nothing
 * extra ships to the browser. Renders on the server.
 */

const tokensText = (value: number) => value.toLocaleString('en-US');

function DailySpendChart({ daily }: { daily: SpendBreakdown['daily'] }) {
  const priced = daily.some(day => day.costMicros > 0);
  const valueOf = (day: SpendBreakdown['daily'][number]) => (priced ? day.costMicros : day.tokens);
  const peak = Math.max(1, ...daily.map(valueOf));
  return (
    <div className="space-y-2">
      <div className="flex h-24 items-end gap-0.5" aria-hidden="true" data-testid="ai-spend-daily">
        {daily.map(day => (
          <div
            key={day.day}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${day.day}: ${formatUsd(day.costMicros)}, ${tokensText(day.tokens)} tokens`}
          >
            <div
              className="rounded-t bg-primary/70"
              style={{
                height: `${Math.max(valueOf(day) > 0 ? 2 : 0, Math.round((valueOf(day) / peak) * 100))}%`,
              }}
            />
          </div>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Show daily spend as a table
        </summary>
        <table className="mt-2 w-full text-left text-xs">
          <caption className="sr-only">AI spend per UTC day</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 font-medium">
                Day (UTC)
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Tokens
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Spend
              </th>
            </tr>
          </thead>
          <tbody>
            {daily.map(day => (
              <tr key={day.day} className="border-t border-border">
                <td className="py-1">{day.day}</td>
                <td className="py-1 text-right">{tokensText(day.tokens)}</td>
                <td className="py-1 text-right">{formatUsd(day.costMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function SliceBars({ title, slices }: { title: string; slices: SpendSlice[] }) {
  const priced = slices.some(slice => slice.costMicros > 0);
  const valueOf = (slice: SpendSlice) => (priced ? slice.costMicros : slice.tokens);
  const total = slices.reduce((sum, slice) => sum + valueOf(slice), 0);
  return (
    <section className="min-w-0 space-y-2" aria-label={`Spend by ${title.toLowerCase()}`}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        By {title.toLowerCase()}
      </h3>
      {slices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No usage in this period.</p>
      ) : (
        <table className="w-full table-fixed text-left text-xs">
          <caption className="sr-only">AI spend by {title.toLowerCase()}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">Tokens</th>
              <th scope="col">Spend</th>
            </tr>
          </thead>
          <tbody>
            {slices.map(slice => {
              const share = total > 0 ? valueOf(slice) / total : 0;
              return (
                <tr key={slice.key} className="align-top">
                  <th scope="row" className="py-1 pr-2 font-normal">
                    <span className="block truncate" title={slice.label}>
                      {slice.label}
                    </span>
                    <span className="mt-1 block h-1.5 rounded bg-muted" aria-hidden="true">
                      <span
                        className="block h-1.5 rounded bg-primary/70"
                        style={{
                          width: `${Math.max(share > 0 ? 2 : 0, Math.round(share * 100))}%`,
                        }}
                      />
                    </span>
                  </th>
                  <td className="w-24 py-1 text-right text-muted-foreground">
                    {tokensText(slice.tokens)}
                  </td>
                  <td className="w-20 py-1 text-right font-medium">
                    {formatUsd(slice.costMicros)}
                    {slice.unpricedRequests > 0 && (
                      <span
                        className="text-muted-foreground"
                        title={`${slice.unpricedRequests} unpriced requests`}
                      >
                        *
                      </span>
                    )}
                    {slice.savedMicros > 0 && (
                      <span className="block font-normal text-muted-foreground">
                        saved {formatUsd(slice.savedMicros)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BudgetMeters({ statuses }: { statuses: BudgetStatus[] }) {
  return (
    <ul className="divide-y divide-border" aria-label="Budget utilisation today">
      {statuses.map(status => {
        const percent = Math.round(status.utilization * 100);
        const tone =
          status.utilization >= 1
            ? 'bg-destructive'
            : status.utilization >= 0.8
              ? 'bg-amber-500'
              : 'bg-primary/70';
        const limits = [
          status.dailyTokenLimit !== null
            ? `${tokensText(status.tokens)} / ${tokensText(status.dailyTokenLimit)} tokens`
            : null,
          status.dailyCostLimitMicros !== null
            ? `${formatUsd(status.costMicros)} / ${formatUsd(status.dailyCostLimitMicros)}`
            : null,
        ].filter(Boolean);
        return (
          <li key={status.key} className="space-y-1 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {status.label}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {status.scope === 'GLOBAL'
                    ? 'global'
                    : status.scope === 'TEAM'
                      ? 'team'
                      : 'capability'}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {limits.join(' · ')} ({percent}%)
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${status.label} budget used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, percent)}
              className="h-2 rounded bg-muted"
            >
              <div
                className={`h-2 rounded ${tone}`}
                style={{ width: `${Math.min(100, Math.max(percent > 0 ? 2 : 0, percent))}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function AiSpendPanel({
  breakdown,
  statuses,
  basePath = '/settings/intelligence/ai',
}: {
  breakdown: SpendBreakdown;
  statuses: BudgetStatus[];
  basePath?: string;
}) {
  return (
    <div className="space-y-5 py-3" id="ai-spend">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap gap-6">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Spend, last {breakdown.days} days
            </dt>
            <dd className="text-lg font-semibold">{formatUsd(breakdown.total.costMicros)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tokens</dt>
            <dd className="text-lg font-semibold">{tokensText(breakdown.total.tokens)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Requests</dt>
            <dd className="text-lg font-semibold">{tokensText(breakdown.total.requests)}</dd>
          </div>
          {(breakdown.total.savedMicros > 0 || breakdown.total.cacheHits > 0) && (
            <div data-testid="ai-spend-saved">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Saved by cache
              </dt>
              <dd className="text-lg font-semibold">
                {formatUsd(breakdown.total.savedMicros)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {tokensText(breakdown.total.cacheHits)} reused{' '}
                  {breakdown.total.cacheHits === 1 ? 'answer' : 'answers'}
                  {breakdown.total.cacheReadTokens > 0 &&
                    ` · ${tokensText(breakdown.total.cacheReadTokens)} cached prompt tokens`}
                </span>
              </dd>
            </div>
          )}
        </dl>
        <nav aria-label="Spend period" className="flex gap-1">
          {([7, 30] as const).map(days => (
            <Link
              key={days}
              href={`${basePath}?spend=${days}#ai-spend`}
              aria-current={breakdown.days === days ? 'page' : undefined}
              className={`min-h-9 rounded-md border px-3 py-1.5 text-sm ${
                breakdown.days === days
                  ? 'border-primary bg-primary/10 font-medium'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {days} days
            </Link>
          ))}
        </nav>
      </div>
      <DailySpendChart daily={breakdown.daily} />
      <div className="grid gap-5 lg:grid-cols-3">
        <SliceBars title="Team" slices={breakdown.byTeam} />
        <SliceBars title="Capability" slices={breakdown.byCapability} />
        <SliceBars title="Model" slices={breakdown.byModel} />
      </div>
      {breakdown.total.unpricedRequests > 0 && (
        <p className="text-xs text-muted-foreground">
          * {tokensText(breakdown.total.unpricedRequests)} requests used a model without a price.
          Their tokens are counted; add a price below to include their dollars.
        </p>
      )}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Budgets today (UTC)
        </h3>
        <BudgetMeters statuses={statuses} />
      </div>
    </div>
  );
}
