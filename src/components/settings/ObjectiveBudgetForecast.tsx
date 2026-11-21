import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ObjectiveForecastView } from '@/lib/slo/forecast-loader';
import { FORECAST_BURN_DAYS } from '@/lib/slo/forecast';

const minutes = (value: number) => `${value.toLocaleString('en-US')} min`;

function outlook(forecast: ObjectiveForecastView) {
  if (forecast.daysLeft === 0)
    return { text: 'Budget spent for this window', variant: 'danger' as const };
  if (forecast.daysLeft === null) {
    return {
      text: `Not burning over the last ${FORECAST_BURN_DAYS} days`,
      variant: 'success' as const,
    };
  }
  const days = forecast.daysLeft >= 10 ? Math.round(forecast.daysLeft) : forecast.daysLeft;
  return {
    text: `About ${days} ${days === 1 ? 'day' : 'days'} left at the ${FORECAST_BURN_DAYS}-day burn (${minutes(forecast.burnPerDay)}/day)`,
    variant:
      forecast.daysLeft < 7
        ? ('danger' as const)
        : forecast.daysLeft < forecast.windowDays
          ? ('warning' as const)
          : ('success' as const),
  };
}

const BAR_TONE = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
} as const;

function BudgetBar({
  value,
  max,
  label,
  variant,
}: {
  value: number;
  max: number;
  label: string;
  variant: keyof typeof BAR_TONE;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {/* eslint-disable-next-line security/detect-object-injection -- variant is a closed union */}
        <div className={cn('h-full rounded-full', BAR_TONE[variant])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Error budget left, how long it lasts at the recent burn, and the incidents that used most of it. */
export default function ObjectiveBudgetForecast({ forecast }: { forecast: ObjectiveForecastView }) {
  const { text, variant } = outlook(forecast);
  return (
    <section
      aria-label="Error budget forecast"
      className="space-y-2 rounded-md bg-muted/40 p-3 text-sm"
    >
      <BudgetBar
        value={forecast.remainingMinutes}
        max={forecast.budgetMinutes}
        label={`Error budget left: ${minutes(forecast.remainingMinutes)} of ${minutes(forecast.budgetMinutes)} (${forecast.windowDays} days)`}
        variant={variant}
      />
      <p className="text-muted-foreground">{text}</p>
      {forecast.topIncidents.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Used most of the budget</p>
          <ul className="divide-y divide-border">
            {forecast.topIncidents.map(item => (
              <li key={item.incidentId} className="flex items-center justify-between gap-3">
                <Link
                  href={`/incidents/${item.incidentId}`}
                  className="flex min-h-11 min-w-0 items-center truncate underline-offset-2 hover:underline"
                >
                  {item.title}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {minutes(item.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
