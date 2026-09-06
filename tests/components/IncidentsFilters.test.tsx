import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import IncidentsFilters from '@/components/incident/IncidentsFilters';

const push = vi.fn();
const searchParams = new URLSearchParams('priority=P1');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => searchParams,
}));

describe('IncidentsFilters', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('updates search params when search input changes', () => {
    render(
      <IncidentsFilters
        currentFilter="all_open"
        currentPriority="P1"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
      />
    );

    const searchInput = screen.getByLabelText('Search');
    fireEvent.change(searchInput, { target: { value: 'database' } });

    expect(push).toHaveBeenCalledWith('/incidents?priority=P1&search=database');
  });

  it('clears all filters when Clear All is clicked', () => {
    render(
      <IncidentsFilters
        currentFilter="all_open"
        currentPriority="P1"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
      />
    );

    const clearButton = screen.getByRole('button', { name: /clear all/i });
    fireEvent.click(clearButton);

    expect(push).toHaveBeenCalledWith('/incidents');
  });
});
