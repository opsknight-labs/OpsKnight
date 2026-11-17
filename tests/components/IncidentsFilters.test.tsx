import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import IncidentsFilters, {
  countActiveAdvancedFilters,
} from '@/components/incident/IncidentsFilters';

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates search params once typing pauses', () => {
    vi.useFakeTimers();
    render(
      <IncidentsFilters
        currentFilter="all_open"
        currentPriority="P1"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
      />
    );

    const searchInput = screen.getByLabelText('Search incidents');
    fireEvent.change(searchInput, { target: { value: 'database' } });
    expect(push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
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

    expect(push).toHaveBeenCalledWith('/incidents?priority=P1&filter=all_open');
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

    const trigger = screen.getByRole('combobox', { name: /filter by service/i });
    expect(trigger).toHaveTextContent('All');
    expect(trigger).not.toHaveTextContent('Billing API');

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

    const trigger = screen.getByRole('combobox', { name: /filter by service/i });
    fireEvent.click(trigger);

    const option = screen.getByText('Auth Service');
    fireEvent.click(option);

    expect(push).toHaveBeenCalledWith('/incidents?priority=P1&serviceId=svc-1');
  });

  it('keeps less-used filters collapsed until one of them is active', () => {
    const { rerender } = render(
      <IncidentsFilters
        currentFilter="all"
        currentPriority="all"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
      />
    );
    expect(screen.getByRole('button', { name: /advanced filters/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByLabelText('Created after')).toBeNull();

    // A drill-down link lands with an advanced filter set: the section opens itself.
    rerender(
      <IncidentsFilters
        currentFilter="all"
        currentPriority="all"
        currentUrgency="all"
        currentSort="newest"
        currentSearch=""
        createdAfter="2026-11-01T00:00:00.000Z"
      />
    );
    const toggle = screen.getByRole('button', { name: /advanced filters/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('1');
    expect(screen.getByLabelText('Created after')).toHaveValue('2026-11-01');
  });

  it('counts each active advanced filter, including snoozed/suppressed drill-downs', () => {
    expect(countActiveAdvancedFilters({ currentFilter: 'all' })).toBe(0);
    expect(countActiveAdvancedFilters({ currentFilter: 'all_open', currentPriority: 'all' })).toBe(
      0
    );
    expect(
      countActiveAdvancedFilters({
        currentFilter: 'snoozed',
        currentPriority: 'P1',
        currentAssignee: 'unassigned',
        createdAfter: '2026-11-01',
        createdBefore: '2026-11-02',
      })
    ).toBe(5);
    expect(countActiveAdvancedFilters({ currentFilter: 'all', currentStatus: 'SUPPRESSED' })).toBe(
      1
    );
  });

  it('marks the Triggered tab active for a status drill-down and clears it on toggle', () => {
    searchParams.set('status', 'OPEN');
    render(
      <IncidentsFilters
        currentFilter="all"
        currentStatus="OPEN"
        currentPriority="all"
        currentUrgency="HIGH"
        currentSort="newest"
        currentSearch=""
      />
    );
    const triggered = screen.getByRole('button', { name: 'Triggered' });
    expect(triggered).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(triggered);
    searchParams.delete('status');
    expect(push).toHaveBeenCalledWith('/incidents?priority=P1');
  });
});
