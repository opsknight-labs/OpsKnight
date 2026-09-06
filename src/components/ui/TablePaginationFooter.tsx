'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type TablePaginationFooterProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  prevHref?: string;
  nextHref?: string;
  pageHref?: (page: number) => string;
  onPageChange?: (page: number) => void;
  className?: string;
};

export default function TablePaginationFooter({
  page,
  pageSize,
  totalCount,
  prevHref,
  nextHref,
  pageHref,
  onPageChange,
  className,
}: TablePaginationFooterProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const resolvedPrevHref = prevHref ?? (pageHref && hasPrev ? pageHref(page - 1) : undefined);
  const resolvedNextHref = nextHref ?? (pageHref && hasNext ? pageHref(page + 1) : undefined);
  const isLinkMode = Boolean(prevHref || nextHref || pageHref);

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-xs text-muted-foreground',
        className
      )}
    >
      <div>
        Showing <span className="font-semibold text-foreground">{startItem}</span> to{' '}
        <span className="font-semibold text-foreground">{endItem}</span> of{' '}
        <span className="font-semibold text-foreground">{totalCount}</span> entries
      </div>

      <div className="flex items-center gap-1.5">
        {isLinkMode ? (
          <>
            <Button
              asChild={hasPrev && Boolean(resolvedPrevHref)}
              variant="outline"
              size="sm"
              disabled={!hasPrev || !resolvedPrevHref}
              className="h-8 gap-1 px-2.5"
            >
              {hasPrev && resolvedPrevHref ? (
                <Link href={resolvedPrevHref} aria-label="Previous page">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </Link>
              ) : (
                <span>
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </span>
              )}
            </Button>

            <span className="px-2 font-medium text-foreground">
              Page {page} of {totalPages}
            </span>

            <Button
              asChild={hasNext && Boolean(resolvedNextHref)}
              variant="outline"
              size="sm"
              disabled={!hasNext || !resolvedNextHref}
              className="h-8 gap-1 px-2.5"
            >
              {hasNext && resolvedNextHref ? (
                <Link href={resolvedNextHref} aria-label="Next page">
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span>
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => onPageChange && onPageChange(page - 1)}
              className="h-8 gap-1 px-2.5"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Previous</span>
            </Button>

            <span className="px-2 font-medium text-foreground">
              Page {page} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => onPageChange && onPageChange(page + 1)}
              className="h-8 gap-1 px-2.5"
              aria-label="Next page"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
