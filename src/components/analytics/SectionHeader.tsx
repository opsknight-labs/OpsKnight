import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Section heading used across Analytics and Reports: title, one-line context, optional actions. */
export default function SectionHeader({
  title,
  description,
  icon,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-1', className)}>
      <div className="min-w-0">
        <h2
          id={id}
          className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
        >
          {icon && (
            <span aria-hidden="true" className="text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">
              {icon}
            </span>
          )}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
