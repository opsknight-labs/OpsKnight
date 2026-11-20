import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import IncidentsFilters from '@/components/incident/IncidentsFilters';

const push = vi.fn();
const replace = vi.fn();
const searchParams = new URLSearchParams('priority=P1');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    replace,
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => searchParams,
}));

describe('IncidentsFilters', () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
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

    vi.useFakeTimers();
    try {
      const searchInput = screen.getByLabelText('Search incidents');
      // "/" in IncidentsListTable focuses the input by this id.
      expect(searchInput).toHaveAttribute('id', 'incident-search');
      fireEvent.change(searchInput, { target: { value: 'database' } });
      act(() => {
        vi.advanceTimersByTime(399);
      });
      expect(replace).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      // Search replaces history (no entry per keystroke) and keeps the scroll position.
      expect(replace).toHaveBeenCalledWith('/incidents?priority=P1&search=database', {
        scroll: false,
      });
      expect(push).not.toHaveBeenCalled();

      // A single character waits for more input.
      replace.mockClear();
      fireEvent.change(searchInput, { target: { value: 'd' } });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

    expect(push).toHaveBeenCalledWith('/incidents', { scroll: false });
  });

  it('navigates to active incidents when Active chip is clicked', () => {
    render(
      <IncidentsFilters
        currentFilter="all"
        currentPriority="all"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
      />
    );

    const activeChip = screen.getByRole('button', { name: 'Active' });
    fireEvent.click(activeChip);

    expect(push).toHaveBeenCalledWith('/incidents?priority=P1&filter=all_open', {
      scroll: false,
    });
  });

  it('renders service combobox with selected service or All services', () => {
    const services = [
      { id: 'svc-1', name: 'Auth Service' },
      { id: 'svc-2', name: 'Billing API' },
    ];

    const { rerender } = render(
      <IncidentsFilters
        currentFilter="all_open"
        currentPriority="all"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
        services={services}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /service & sort/i }));
    const trigger = screen.getByRole('combobox', { name: /filter by service/i });
    expect(trigger).toHaveTextContent('All services');

    rerender(
      <IncidentsFilters
        currentFilter="all_open"
        currentPriority="all"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
        currentServiceId="svc-2"
        services={services}
      />
    );

    expect(screen.getByRole('combobox', { name: /filter by service/i })).toHaveTextContent(
      'Billing API'
    );
  });

  it('selects service from combobox and updates search params', () => {
    const services = [
      { id: 'svc-1', name: 'Auth Service' },
      { id: 'svc-2', name: 'Billing API' },
    ];

    render(
      <IncidentsFilters
        currentFilter="all_open"
        currentPriority="P1"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
        services={services}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /service & sort/i }));
    const trigger = screen.getByRole('combobox', { name: /filter by service/i });
    fireEvent.click(trigger);

    const option = screen.getByText('Auth Service');
    fireEvent.click(option);

    expect(push).toHaveBeenCalledWith('/incidents?priority=P1&serviceId=svc-1', {
      scroll: false,
    });
  });
});
