'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

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
  const searchParams = useSearchParams();

  // Build URL with current query params but update page
  const buildPageUrl = (page: number) => {
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      if (key !== 'page') {
        params.append(key, value);
      }
    });
    if (page > 1) {
      params.append('page', page.toString());
    }
    return `/incidents?${params.toString()}`;
  };

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  if (totalPages <= 1) {
    return (
      <div
        style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border)',
          background: '#f9fafb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
        }}
      >
        <span>
          Showing {totalItems} incident{totalItems !== 1 ? 's' : ''}
        </span>
      </div>
    );
  }

  // Calculate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      // Show all pages if total is less than max
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div
      style={{
        padding: '1rem 1.5rem',
        borderTop: '1px solid var(--border)',
        background: '#f9fafb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
      }}
    >
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Showing {startItem} to {endItem} of {totalItems} incident{totalItems !== 1 ? 's' : ''}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Previous button */}
        <Link
          href={buildPageUrl(currentPage - 1)}
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '0px',
            background: currentPage === 1 ? '#f3f4f6' : 'white',
            color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
            textDecoration: 'none',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
            opacity: currentPage === 1 ? 0.6 : 1,
            pointerEvents: currentPage === 1 ? 'none' : 'auto',
          }}
        >
          ← Previous
        </Link>

        {/* Page numbers */}
        {pageNumbers.map((page, index) => {
          if (page === '...') {
            return (
              <span
                key={`ellipsis-${index}`}
                style={{
                  padding: '0.5rem 0.75rem',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              >
                ...
              </span>
            );
          }

          const pageNum = page as number;
          const isCurrentPage = pageNum === currentPage;

          return (
            <Link
              key={pageNum}
              href={buildPageUrl(pageNum)}
              style={{
                padding: '0.5rem 0.75rem',
                border: `1px solid ${isCurrentPage ? 'var(--primary-color)' : 'var(--border)'}`,
                borderRadius: '0px',
                background: isCurrentPage ? 'var(--primary-color)' : 'white',
                color: isCurrentPage ? 'white' : 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: '0.85rem',
                fontWeight: isCurrentPage ? 700 : 600,
                minWidth: '2.5rem',
                textAlign: 'center',
                display: 'inline-block',
              }}
            >
              {pageNum}
            </Link>
          );
        })}

        {/* Next button */}
        <Link
          href={buildPageUrl(currentPage + 1)}
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '0px',
            background: currentPage === totalPages ? '#f3f4f6' : 'white',
            color: currentPage === totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
            textDecoration: 'none',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
            opacity: currentPage === totalPages ? 0.6 : 1,
            pointerEvents: currentPage === totalPages ? 'none' : 'auto',
          }}
        >
          Next →
        </Link>
      </div>
    </div>
  );
}
