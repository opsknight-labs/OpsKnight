import { cn } from '@/lib/utils';
import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react';

export type SafetyBudget = { label: string; used: number; limit: number };

/** Compact, enterprise per-incident automation budget meters with clean status chips and progress bars. */
export default function AutomationSafetyMeter({ items }: { items: SafetyBudget[] }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-3">
      {items.map(item => {
        const exhausted = item.limit > 0 && item.used >= item.limit;
        const isDisabled = item.limit === 0;
        const percent =
          item.limit > 0 ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 0;

        return (
          <li
            key={item.label}
            className={cn(
              'rounded-xl border p-2.5 sm:p-3 transition-all duration-200',
              exhausted
                ? 'border-amber-500/40 bg-amber-500/[0.04]'
                : isDisabled
                  ? 'border-border/60 bg-muted/20'
                  : 'border-border/70 bg-card/70 hover:bg-card hover:border-border shadow-2xs'
            )}
          >
            <div className="flex items-center justify-between gap-1.5 text-xs">
              <span className="truncate font-medium text-foreground/85 flex items-center gap-1.5">
                {isDisabled ? (
                  <Lock className="h-3 w-3 text-muted-foreground/70 shrink-0" aria-hidden />
                ) : exhausted ? (
                  <ShieldAlert className="h-3 w-3 text-amber-500 shrink-0" aria-hidden />
                ) : (
                  <ShieldCheck className="h-3 w-3 text-emerald-500/80 shrink-0" aria-hidden />
                )}
                <span className="truncate">{item.label}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-md border shadow-2xs',
                  exhausted
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : isDisabled
                      ? 'bg-muted/60 text-muted-foreground border-border/50'
                      : item.used > 0
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
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
              className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  exhausted
                    ? 'bg-amber-500'
                    : isDisabled
                      ? 'bg-muted-foreground/30'
                      : percent > 0
                        ? 'bg-primary'
                        : 'bg-emerald-500/70'
                )}
                style={{
                  width: isDisabled ? '0%' : `${Math.max(percent, item.used > 0 ? 6 : 0)}%`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
