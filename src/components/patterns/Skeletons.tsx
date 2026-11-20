import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

/** Wraps a preset so assistive tech hears one "Loading" instead of many empty boxes. */
function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

const CELL_WIDTHS = ['w-2/3', 'w-1/2', 'w-1/3', 'w-3/4', 'w-2/5', 'w-1/4'];

function cellWidth(row: number, col: number): string {
  return CELL_WIDTHS.at((row + col * 2) % CELL_WIDTHS.length) ?? 'w-1/2';
}

/** Table/list rows in the shape of a DataTable: header row plus `rows` body rows. */
export function TableRowsSkeleton({
  rows = 5,
  columns = 4,
  showHeader = true,
  label = 'Loading rows',
  className,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  label?: string;
  className?: string;
}) {
  const cols = Array.from({ length: columns });
  return (
    <LoadingRegion
      label={label}
      className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      {showHeader && (
        <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-3">
          {cols.map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-3', c === 0 ? 'flex-[2]' : 'flex-1', 'max-w-[8rem]')}
            />
          ))}
        </div>
      )}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {cols.map((__, c) => (
              <div key={c} className={c === 0 ? 'flex-[2] space-y-1.5' : 'flex-1'}>
                <Skeleton className={cn('h-3.5', cellWidth(r, c))} />
                {c === 0 && <Skeleton className="h-3 w-1/3" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Grid of cards (directory pages, service grids). */
export function CardGridSkeleton({
  cards = 6,
  columns = 3,
  label = 'Loading cards',
  className,
}: {
  cards?: number;
  columns?: 1 | 2 | 3 | 4;
  label?: string;
  className?: string;
}) {
  return (
    <LoadingRegion
      label={label}
      className={cn(
        'grid grid-cols-1 gap-4',
        columns >= 2 && 'sm:grid-cols-2',
        columns >= 3 && 'lg:grid-cols-3',
        columns >= 4 && 'xl:grid-cols-4',
        className
      )}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={cn('h-4', cellWidth(i, 0))} />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** Detail page: dark header band, tab strip, main column and side rail. */
export function DetailPageSkeleton({
  label = 'Loading details',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <LoadingRegion label={label} className={cn('space-y-4', className)}>
      <div className="ok-inverse-surface rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 dark:border-zinc-700/60 dark:from-[#18181d] dark:to-[#111114] sm:p-5">
        <div className="flex items-start gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="hidden h-9 w-28 rounded-md sm:block" />
        </div>
      </div>
      <div className="flex gap-2 border-b border-border pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
              <Skeleton className="h-4 w-1/3" />
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
