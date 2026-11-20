import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { cn } from '@/lib/utils';

type SectionCardProps = {
  id: string;
  title: string;
  description?: ReactNode;
  /** Usually a <MetricInfo>; sits beside the title. */
  info?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** The frame every analytics section uses: titled card, optional actions. */
export function SectionCard({
  id,
  title,
  description,
  info,
  actions,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn('min-w-0 rounded-lg border bg-card text-card-foreground shadow-sm', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          {/* The info button sits beside the heading, not inside it, so the section name stays clean. */}
          <div className="flex items-center gap-1.5">
            <h2 id={id} className="text-base font-semibold">
              {title}
            </h2>
            {info}
          </div>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Loading placeholder in the shape of a section, so the layout doesn't jump. */
export function SectionSkeleton({
  title,
  height = 'h-60',
  className,
}: {
  title: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={`Loading ${title}`}
      className={cn('min-w-0 rounded-lg border bg-card shadow-sm', className)}
    >
      <div className="border-b px-4 py-3 sm:px-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
      </div>
      <div className="p-4 sm:p-5">
        <Skeleton className={cn('w-full', height)} />
      </div>
    </div>
  );
}
