import type { ComponentType, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RunbookPageHeaderProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className?: string;
};

export function RunbookPageHeader({
  title,
  description,
  badge,
  actions,
  breadcrumbs,
  icon: Icon,
  className,
}: RunbookPageHeaderProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${idx}`} className="flex min-w-0 items-center gap-1">
                  {idx > 0 && (
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 text-muted-foreground/50"
                    />
                  )}
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={isLast ? 'page' : undefined}
                      className={cn('truncate', isLast && 'font-medium text-foreground')}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 sm:flex">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              <span className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
                Beta
              </span>
              {badge}
            </div>
            {description && (
              <div className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {description}
              </div>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        )}
      </div>
    </div>
  );
}
