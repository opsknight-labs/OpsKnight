import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Card shell shared by every section in the incident detail right rail. */
export const railCardClass =
  'min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xs';

/** Header row shared by the right-rail sections: icon, sentence-case title, count, action. */
export function RailSectionHeader({
  icon,
  title,
  titleId,
  count,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  titleId?: string;
  count?: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon && (
          <span className="shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden>
            {icon}
          </span>
        )}
        <h2 id={titleId} className="truncate text-sm font-semibold text-foreground">
          {title}
        </h2>
        {typeof count === 'number' && (
          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
}
