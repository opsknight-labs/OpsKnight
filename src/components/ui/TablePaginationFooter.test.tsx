import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TablePaginationFooter from './TablePaginationFooter';

describe('TablePaginationFooter', () => {
  it('renders correctly with string prevHref and nextHref (RSC boundary safe)', () => {
    render(
      <TablePaginationFooter
        page={2}
        pageSize={50}
        totalCount={120}
        prevHref="/audit?page=1"
        nextHref="/audit?page=3"
      />
    );

    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText('51')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();

    const prevLink = screen.getByLabelText('Previous page');
    expect(prevLink).toHaveAttribute('href', '/audit?page=1');

    const nextLink = screen.getByLabelText('Next page');
    expect(nextLink).toHaveAttribute('href', '/audit?page=3');
  });

  it('disables previous on page 1 and next on last page', () => {
    const { rerender } = render(
      <TablePaginationFooter
        page={1}
        pageSize={50}
        totalCount={100}
        prevHref={undefined}
        nextHref="/audit?page=2"
      />
    );

    const prevButton = screen.getByRole('button', { name: /previous/i });
    expect(prevButton).toBeDisabled();

    rerender(
      <TablePaginationFooter
        page={2}
        pageSize={50}
        totalCount={100}
        prevHref="/audit?page=1"
        nextHref={undefined}
      />
    );

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  it('supports onPageChange callback in interactive client mode', () => {
    const onPageChange = vi.fn();
    render(
      <TablePaginationFooter page={2} pageSize={50} totalCount={150} onPageChange={onPageChange} />
    );

    const prevButton = screen.getByRole('button', { name: 'Previous page' });
    fireEvent.click(prevButton);
    expect(onPageChange).toHaveBeenCalledWith(1);

    const nextButton = screen.getByRole('button', { name: 'Next page' });
    fireEvent.click(nextButton);
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
