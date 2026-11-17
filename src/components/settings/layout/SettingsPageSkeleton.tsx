import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { CardGridSkeleton, TableRowsSkeleton } from '@/components/patterns';
import { cn } from '@/lib/utils';

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="space-y-2 border-b border-border px-4 py-4 md:px-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>
      <div className="divide-y divide-border px-4 md:px-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-3 py-4 md:grid-cols-[40%_1fr] md:gap-6">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading state for a settings page: breadcrumb row, header, then the page body in the
 * shape it will take (`form` sections, a `table`, or `cards`).
 */
export default function SettingsPageSkeleton({
  label = 'Loading settings',
  variant = 'form',
  sections = 2,
  rows = 3,
  statsCount = 0,
  tabs = false,
  className,
}: {
  label?: string;
  variant?: 'form' | 'table' | 'cards';
  sections?: number;
  rows?: number;
  statsCount?: number;
  /** Show a tab strip under the header (pages with in-page tabs). */
  tabs?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-6', className)}>
      <div className="space-y-4" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="hidden h-9 w-36 sm:block" />
        </div>
        <DetailHeroBannerSkeleton statsCount={statsCount} hasActions={false} />
        {tabs && (
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
          </div>
        )}
      </div>
      {variant === 'table' ? (
        <TableRowsSkeleton rows={rows} columns={5} label={label} />
      ) : variant === 'cards' ? (
        <CardGridSkeleton cards={rows} columns={2} label={label} />
      ) : (
        <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
          <span className="sr-only">{label}</span>
          <div aria-hidden="true" className="space-y-6">
            {Array.from({ length: sections }).map((_, i) => (
              <SectionSkeleton key={i} rows={rows} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
