import { cn } from '@/lib/utils';

export type SafetyBudget = { label: string; used: number; limit: number };

/** Compact per-incident automation budget meters. */
export default function AutomationSafetyMeter({ items }: { items: SafetyBudget[] }) {
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
      {items.map(item => {
        const exhausted = item.used >= item.limit;
        const percent =
          item.limit > 0 ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 0;
        return (
          <li key={item.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span
                className={cn(
                  'shrink-0 font-medium tabular-nums',
                  exhausted && item.limit > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-foreground'
                )}
              >
                {item.limit > 0
                  ? `${item.used} / ${item.limit}`
                  : item.used > 0
                    ? `${item.used} / 0`
                    : 'Off'}
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${item.label} used`}
              aria-valuemin={0}
              aria-valuemax={item.limit}
              aria-valuenow={Math.min(item.used, item.limit)}
              aria-valuetext={
                item.limit > 0 ? `${item.used} of ${item.limit} used` : 'Not allowed automatically'
              }
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  exhausted ? 'bg-amber-500' : 'bg-foreground/50'
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
