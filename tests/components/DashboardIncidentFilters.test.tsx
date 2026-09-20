import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DashboardIncidentFilters from '@/components/dashboard/DashboardIncidentFilters';

const push = vi.fn();
const searchParams = new URLSearchParams('range=30d');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/components/DashboardTimeRange', () => ({
  default: () => <div data-testid="dashboard-time-range" />,
}));

describe('DashboardIncidentFilters', () => {
  const services = [
    { id: 'svc-payments', name: 'Payments API' },
    { id: 'svc-auth', name: 'Auth Gateway' },
  ];

  beforeEach(() => {
    push.mockClear();
  });

  it('renders service combobox with All services or selected service', () => {
    const { rerender } = render(
      <DashboardIncidentFilters
        services={services}
        users={[]}
        currentStatus="all"
        currentUrgency="all"
        currentService="all"
        currentAssignee="all"
        currentSearch=""
        currentSort="newest"
        currentRange="30d"
      />
    );

    const trigger = screen.getByRole('combobox', { name: /filter by service/i });
    expect(trigger).toHaveTextContent('All services');

    rerender(
      <DashboardIncidentFilters
        services={services}
        users={[]}
        currentStatus="all"
        currentUrgency="all"
        currentService="svc-payments"
        currentAssignee="all"
        currentSearch=""
        currentSort="newest"
        currentRange="30d"
      />
    );

    expect(screen.getByRole('combobox', { name: /filter by service/i })).toHaveTextContent(
      'Payments API'
    );
  });

  it('selects service from combobox and updates search params', () => {
    render(
      <DashboardIncidentFilters
        services={services}
        users={[]}
        currentStatus="all"
        currentUrgency="all"
        currentService="all"
        currentAssignee="all"
        currentSearch=""
        currentSort="newest"
        currentRange="30d"
      />
    );

    const trigger = screen.getByRole('combobox', { name: /filter by service/i });
    fireEvent.click(trigger);

    const option = screen.getByText('Payments API');
    fireEvent.click(option);

    expect(push).toHaveBeenCalledWith('/?range=30d&service=svc-payments', { scroll: false });
  });
});
