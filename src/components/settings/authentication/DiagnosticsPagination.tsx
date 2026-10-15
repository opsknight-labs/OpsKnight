'use client';
import { Button } from '@/components/ui/shadcn/button';

export default function DiagnosticsPagination({
  label,
  page,
  count,
  pageSize,
  hasPrevious,
  hasNext,
  loading,
  onPrevious,
  onNext,
  onFirst,
}: {
  label: string;
  page: number;
  count: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onFirst: () => void;
}) {
  return (
    <nav
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-y border-border py-3 text-sm"
    >
      <p role="status" className="text-muted-foreground tabular-nums">
        {count
          ? `${page * pageSize + 1}–${page * pageSize + count} of many`
          : 'No matching records'}{' '}
        · {pageSize} / page
      </p>
      <div className="flex flex-wrap gap-2">
        {page > 0 && (
          <Button variant="ghost" size="sm" disabled={loading} onClick={onFirst}>
            First page
          </Button>
        )}
        <Button
          title={
            loading
              ? 'Wait for this page to load.'
              : !hasPrevious
                ? 'You are at the first retained page.'
                : 'Show previous page'
          }
          variant="outline"
          size="sm"
          disabled={loading || !hasPrevious}
          onClick={onPrevious}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !hasNext}
          onClick={onNext}
          aria-label="Next page"
          title={
            loading
              ? 'Wait for this page to load.'
              : !hasNext
                ? 'No further matching records.'
                : 'Show next page'
          }
        >
          Next
        </Button>
      </div>
      {!hasPrevious && page > 0 && (
        <p className="basis-full text-xs text-muted-foreground">
          Earlier page history is no longer retained. Choose First page to restart this
          investigation.
        </p>
      )}
    </nav>
  );
}
