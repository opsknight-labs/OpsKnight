'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
};

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
}: PaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build URL with current query params but update page
  const buildPageUrl = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) {
      params.set('page', page.toString());
    } else {
      params.delete('page');
    }
    return `${pathname}?${params.toString()}`;
  };

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between px-4 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
        <span className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{totalItems}</span> service
          {totalItems !== 1 ? 's' : ''}
        </span>
      </div>
    );
  }

  // Calculate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50 rounded-b-xl gap-4">
      <div className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{startItem}</span> to{' '}
        <span className="font-medium text-foreground">{endItem}</span> of{' '}
        <span className="font-medium text-foreground">{totalItems}</span> services
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 hidden sm:flex"
          disabled={currentPage === 1}
          asChild={currentPage !== 1}
        >
          {currentPage === 1 ? (
            <ChevronsLeft className="h-4 w-4 opacity-50" />
          ) : (
            <Link href={buildPageUrl(1)} aria-label="First page">
              <ChevronsLeft className="h-4 w-4" />
            </Link>
          )}
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={currentPage === 1}
          asChild={currentPage !== 1}
        >
          {currentPage === 1 ? (
            <ChevronLeft className="h-4 w-4 opacity-50" />
          ) : (
            <Link href={buildPageUrl(currentPage - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          )}
        </Button>

        <div className="flex items-center gap-1 mx-1">
          {pageNumbers.map((page, index) => {
            if (page === '...') {
              return (
                <span
                  key={`ellipsis-${index}`}
                  className="flex items-center justify-center w-8 h-8 text-muted-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              );
            }

            const pageNum = page as number;
            const isCurrentPage = pageNum === currentPage;

            return (
              <Button
                key={pageNum}
                variant={isCurrentPage ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-8 w-8 p-0 font-medium',
                  isCurrentPage ? 'pointer-events-none' : 'hover:bg-slate-100'
                )}
                asChild={!isCurrentPage}
              >
                {isCurrentPage ? pageNum : <Link href={buildPageUrl(pageNum)}>{pageNum}</Link>}
              </Button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={currentPage === totalPages}
          asChild={currentPage !== totalPages}
        >
          {currentPage === totalPages ? (
            <ChevronRight className="h-4 w-4 opacity-50" />
          ) : (
            <Link href={buildPageUrl(currentPage + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 hidden sm:flex"
          disabled={currentPage === totalPages}
          asChild={currentPage !== totalPages}
        >
          {currentPage === totalPages ? (
            <ChevronsRight className="h-4 w-4 opacity-50" />
          ) : (
            <Link href={buildPageUrl(totalPages)} aria-label="Last page">
              <ChevronsRight className="h-4 w-4" />
            </Link>
          )}
        </Button>
      </div>
    </div>
  );
}
