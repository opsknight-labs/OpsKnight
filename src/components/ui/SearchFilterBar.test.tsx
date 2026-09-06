import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchFilterBar from './SearchFilterBar';

describe('SearchFilterBar', () => {
  it('renders search input with proper left padding to avoid icon overlap', () => {
    const onSearchChange = vi.fn();
    render(
      <SearchFilterBar
        searchValue=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Search postmortems, incidents, services..."
      />
    );

    const input = screen.getByPlaceholderText('Search postmortems, incidents, services...');
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass('pl-10');
    expect(input).not.toHaveClass('px-3');
  });

  it('handles search input and clear button', () => {
    const onSearchChange = vi.fn();
    render(<SearchFilterBar searchValue="Database Outage" onSearchChange={onSearchChange} />);

    const clearButton = screen.getByLabelText('Clear search');
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('renders filter slots and reset button', () => {
    const onResetFilters = vi.fn();
    render(
      <SearchFilterBar
        filters={<div data-testid="custom-filter">Filter</div>}
        hasActiveFilters={true}
        onResetFilters={onResetFilters}
      />
    );

    expect(screen.getByTestId('custom-filter')).toBeInTheDocument();
    const resetButton = screen.getByRole('button', { name: /reset/i });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(onResetFilters).toHaveBeenCalled();
  });
});
