import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

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

function TableRows({
  rows,
  columns,
  showHeader = true,
}: {
  rows: number;
  columns: number;
  showHeader?: boolean;
}) {
  const cols = Array.from({ length: columns });
  return (
    <>
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
    </>
  );
}

/** Standalone table/list rows (own loading region): header row plus `rows` body rows. */
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
  return (
    <LoadingRegion
      label={label}
      className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      <TableRows rows={rows} columns={columns} showHeader={showHeader} />
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

// ---------------------------------------------------------------------------
// Page skeleton system. Mirrors the real page: DetailHeroBanner -> FilterBar -> Directory/body.
// Pieces carry no loading region; presets add exactly one (sr-only label + aria-busy).
// ---------------------------------------------------------------------------

const PAGE_SHELL = 'mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8';

function PageRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <LoadingRegion label={label} className={cn(PAGE_SHELL, className)}>
      <div className="space-y-6">{children}</div>
    </LoadingRegion>
  );
}

/** Page header: the universal DetailHeroBanner skeleton. */
export function HeaderSkeleton({
  stats = 3,
  actions = false,
  breadcrumb = false,
}: {
  stats?: number;
  actions?: boolean;
  breadcrumb?: boolean;
}) {
  return (
    <DetailHeroBannerSkeleton statsCount={stats} hasActions={actions} hasBreadcrumb={breadcrumb} />
  );
}

/** FilterBar: one chips row plus one control row (search + selects). */
export function FilterBarSkeleton({
  chips = 3,
  controls = 1,
}: {
  chips?: number;
  controls?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="space-y-2.5 rounded-lg border border-border bg-card p-2.5 shadow-sm"
    >
      <div className="flex gap-1.5">
        {Array.from({ length: chips }).map((_, i) => (
          <Skeleton key={i} className={cn('h-7 rounded-full', i === 0 ? 'w-14' : 'w-28')} />
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full md:max-w-md" />
        {Array.from({ length: controls - 1 }).map((_, i) => (
          <Skeleton key={i} className="hidden h-9 w-36 sm:block" />
        ))}
      </div>
    </div>
  );
}

/** Directory card: header row plus table rows; phone rows below `md` like DirectoryTable. */
export function DirectorySkeleton({ rows = 8, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="divide-y divide-border md:hidden">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={cn('h-3.5', cellWidth(r, 0))} />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <TableRows rows={rows} columns={columns} />
      </div>
    </div>
  );
}

/** Two-column detail layout: tab strip, main cards, side rail. */
export function DetailBodySkeleton({ tabs = 4 }: { tabs?: number }) {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="flex gap-2 border-b border-border pb-2">
        {Array.from({ length: tabs }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm"
            >
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm"
            >
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
    </div>
  );
}

/** Settings body: form sections, a directory table, or a card grid. */
export function SettingsBodySkeleton({
  variant = 'form',
  sections = 2,
  rows = 3,
}: {
  variant?: 'form' | 'table' | 'cards';
  sections?: number;
  rows?: number;
}) {
  if (variant === 'table') return <DirectorySkeleton rows={rows} columns={5} />;
  if (variant === 'cards') {
    return (
      <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className={cn('h-4', cellWidth(i, 0))} />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="space-y-6">
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="space-y-2 border-b border-border px-4 py-4 md:px-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
          <div className="divide-y divide-border px-4 md:px-6">
            {Array.from({ length: rows }).map((__, j) => (
              <div key={j} className="grid gap-3 py-4 md:grid-cols-[40%_1fr] md:gap-6">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Log table: one filter row (search, labelled selects, action) above a table card. */
export function LogTableSkeleton({
  rows = 8,
  columns = 5,
  filters = 2,
}: {
  rows?: number;
  columns?: number;
  filters?: number;
}) {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm md:flex-row md:items-end">
        <Skeleton className="h-9 w-full md:max-w-md" />
        {Array.from({ length: filters }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-40" />
          </div>
        ))}
        <Skeleton className="h-9 w-36 md:ml-auto" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <TableRows rows={rows} columns={columns} />
      </div>
    </div>
  );
}

type PresetProps = { label: string; className?: string };

/** Directory page: header, filter bar, directory card. */
export function ListPageSkeleton({
  label,
  stats = 3,
  actions = false,
  chips = 3,
  rows = 8,
  columns = 4,
  className,
}: PresetProps & {
  stats?: number;
  actions?: boolean;
  chips?: number;
  rows?: number;
  columns?: number;
}) {
  return (
    <PageRegion label={label} className={className}>
      <HeaderSkeleton stats={stats} actions={actions} />
      <FilterBarSkeleton chips={chips} />
      <DirectorySkeleton rows={rows} columns={columns} />
    </PageRegion>
  );
}

/** Detail page: breadcrumb + header, tab strip, main column and side rail. */
export function DetailPageSkeleton({
  label = 'Loading details',
  stats = 4,
  tabs = 4,
  className,
}: Partial<PresetProps> & { stats?: number; tabs?: number }) {
  return (
    <PageRegion label={label} className={className}>
      <HeaderSkeleton stats={stats} actions breadcrumb />
      <DetailBodySkeleton tabs={tabs} />
    </PageRegion>
  );
}

/** Settings page: breadcrumb row, header, optional tab strip, then the body. */
export function SettingsPageSkeleton({
  label = 'Loading settings',
  variant = 'form',
  sections = 2,
  rows = 3,
  statsCount = 0,
  tabs = false,
  className,
}: Partial<PresetProps> & {
  variant?: 'form' | 'table' | 'cards';
  sections?: number;
  rows?: number;
  statsCount?: number;
  /** Show a tab strip under the header (pages with in-page tabs). */
  tabs?: boolean;
}) {
  return (
    <LoadingRegion label={label} className={className}>
      <div className="space-y-6">
        <div aria-hidden="true" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-56" />
            <Skeleton className="hidden h-9 w-36 sm:block" />
          </div>
          <HeaderSkeleton stats={statsCount} />
          {tabs && (
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-28" />
              ))}
            </div>
          )}
        </div>
        <SettingsBodySkeleton variant={variant} sections={sections} rows={rows} />
      </div>
    </LoadingRegion>
  );
}

/** Dashboard/report page: header, KPI tiles, chart panels. */
export function DashboardPageSkeleton({
  label,
  stats = 4,
  panels = 3,
  actions = false,
  className,
}: PresetProps & { stats?: number; panels?: number; actions?: boolean }) {
  return (
    <PageRegion label={label} className={className}>
      <HeaderSkeleton stats={stats} actions={actions} />
      <div aria-hidden="true" className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: panels }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ))}
      </div>
    </PageRegion>
  );
}

/** Log pages (audit, events, system logs): header, filter row, table. */
export function LogPageSkeleton({
  label,
  statsCount = 1,
  filterCount = 2,
  columns = 5,
  className,
}: PresetProps & { statsCount?: number; filterCount?: number; columns?: number }) {
  return (
    <PageRegion label={label} className={className}>
      <HeaderSkeleton stats={statsCount} />
      <LogTableSkeleton columns={columns} filters={filterCount} />
    </PageRegion>
  );
}
