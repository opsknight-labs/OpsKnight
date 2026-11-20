import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FilterBar, { FilterChip, FilterField } from '@/components/patterns/FilterBar';

describe('FilterBar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the title row, labelled filter slots and "Clear all" only when filters are active', () => {
    const onClearAll = vi.fn();
    const { rerender } = render(
      <FilterBar
        title="Filter incidents"
        filters={
          <FilterField label="Status" htmlFor="status">
            <select id="status" />
          </FilterField>
        }
        onClearAll={onClearAll}
      />
    );
    expect(screen.getByRole('region', { name: 'Filter incidents' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull();

    rerender(<FilterBar title="Filter incidents" hasActiveFilters onClearAll={onClearAll} />);
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('debounces search and clears immediately', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterBar search={{ value: '', onChange, placeholder: 'Search', debounceMs: 300 }} />);
    const input = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(input, { target: { value: 'db' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledWith('db');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('exposes chip state and a collapsible advanced section', () => {
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    render(
      <FilterBar
        chips={
          <>
            <FilterChip active onClick={onToggle}>
              Mine
            </FilterChip>
            <FilterChip onRemove={onRemove}>Service: API</FilterChip>
          </>
        }
        advanced={<div>Team filter</div>}
        advancedActiveCount={2}
      />
    );
    expect(screen.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Service: API' }));
    expect(onRemove).toHaveBeenCalled();

    const toggle = screen.getByRole('button', { name: /advanced filters/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Team filter')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Team filter')).toBeInTheDocument();
  });
});
