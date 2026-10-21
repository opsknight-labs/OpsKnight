import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { cn } from '@/lib/utils';

export type RunbookSkeletonVariant =
  | 'library'
  | 'executions'
  | 'runbook-detail'
  | 'execution-detail'
  | 'agents'
  | 'pools'
  | 'secrets'
  | 'security'
  | 'health';

const LABELS = new Map<RunbookSkeletonVariant, string>([
  ['library', 'runbook library'],
  ['executions', 'executions'],
  ['runbook-detail', 'runbook'],
  ['execution-detail', 'execution'],
  ['agents', 'Agent fleet'],
  ['pools', 'Agent pools'],
  ['secrets', 'scoped secrets'],
  ['security', 'fleet security'],
  ['health', 'automation health'],
]);

function Card({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 shadow-xs',
        className
      )}
    >
      {children}
    </div>
  );
}

function Header({
  breadcrumbs = false,
  action = true,
}: {
  breadcrumbs?: boolean;
  action?: boolean;
}) {
  return (
    <div className="space-y-3">
      {breadcrumbs && <Skeleton className="h-3 w-48" />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {action && <Skeleton className="h-9 w-32 rounded-md" />}
      </div>
    </div>
  );
}

function ModuleNav() {
  return (
    <div className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl border border-border/80 bg-muted/60 p-1.5 backdrop-blur-xs shadow-2xs">
      {[0, 1, 2, 3].map(i => (
        <Skeleton key={i} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

function SubNav() {
  return (
    <div className="flex gap-4 border-b pb-2">
      {[60, 52, 60, 64].map((width, index) => (
        <Skeleton key={`${width}-${index}`} className="h-5" style={{ width }} />
      ))}
    </div>
  );
}

function Tiles({ count = 4 }: { count?: number }) {
  return (
    <div
      className={cn(
        'grid gap-3',
        count === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-12" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function FilterBar() {
  return (
    <Card className="flex flex-wrap items-center gap-2 p-3">
      <Skeleton className="h-9 min-w-[12rem] flex-1" />
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-9 w-24" />
    </Card>
  );
}

function Rows({ count = 6 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="border-b bg-muted/40 px-4 py-3">
        <Skeleton className="h-3 w-1/3" />
      </div>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
          <Skeleton className="h-2 w-2 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

function CardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-8 w-28" />
        </Card>
      ))}
    </div>
  );
}

function Body({ variant }: { variant: RunbookSkeletonVariant }) {
  switch (variant) {
    case 'library':
      return (
        <>
          <FilterBar />
          <CardGrid />
        </>
      );
    case 'executions':
      return (
        <>
          <Tiles count={5} />
          <FilterBar />
          <Rows count={8} />
        </>
      );
    case 'runbook-detail':
      return (
        <>
          <div className="flex gap-2">
            {[72, 64, 80, 72].map((width, index) => (
              <Skeleton key={`${width}-${index}`} className="h-8" style={{ width }} />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card className="space-y-4">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </Card>
            <Card className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
            </Card>
          </div>
        </>
      );
    case 'execution-detail':
      return (
        <>
          <Tiles />
          <Card className="space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="h-6 w-6 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </Card>
        </>
      );
    case 'agents':
      return (
        <>
          <SubNav />
          <Tiles />
          <FilterBar />
          <Rows />
        </>
      );
    case 'pools':
      return (
        <>
          <SubNav />
          <CardGrid />
        </>
      );
    case 'secrets':
      return (
        <>
          <SubNav />
          <Rows count={5} />
        </>
      );
    case 'security':
      return (
        <>
          <SubNav />
          <div className="grid gap-6 lg:grid-cols-2">
            {[0, 1, 2].map(index => (
              <Card key={index} className={cn('space-y-3', index === 0 && 'lg:col-span-2')}>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full max-w-lg" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-40" />
              </Card>
            ))}
          </div>
        </>
      );
    case 'health':
      return (
        <>
          <Card className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
          </Card>
          <Tiles />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map(index => (
              <Card key={index} className="space-y-3">
                <Skeleton className="h-4 w-32" />
                {[0, 1, 2, 3].map(row => (
                  <Skeleton key={row} className="h-3 w-full" />
                ))}
              </Card>
            ))}
          </div>
        </>
      );
  }
}

/** Route-level loading state that mirrors the real runbook page layout to avoid layout shift. */
export function RunbookPageSkeleton({ variant }: { variant: RunbookSkeletonVariant }) {
  const detail = variant === 'runbook-detail' || variant === 'execution-detail';
  const fleet = variant === 'pools' || variant === 'secrets' || variant === 'security';
  return (
    <div
      aria-busy="true"
      className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8"
    >
      <span className="sr-only">Loading {LABELS.get(variant)}…</span>
      <Header breadcrumbs={detail || fleet} action={variant !== 'health'} />
      <ModuleNav />
      <Body variant={variant} />
    </div>
  );
}
