import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const actions = vi.hoisted(() => ({ set: vi.fn(), search: vi.fn() }));
vi.mock('@/components/incident/detail/actions', () => ({
  setIncidentDetailBusinessImpact: actions.set,
  searchIncidentDetailBusinessServices: actions.search,
}));
const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: notifyMock }));

import IncidentImpacts from '@/components/incident/detail/IncidentImpacts';

beforeEach(() => {
  vi.clearAllMocks();
  actions.set.mockResolvedValue(undefined);
  actions.search.mockResolvedValue([
    { id: 'pay', name: 'Payments', criticality: 'TIER_1', status: 'DEGRADED' },
  ]);
});

const impacts = [
  {
    id: 'co',
    name: 'Checkout',
    source: 'DIRECT' as const,
    excluded: false,
    active: true,
    criticality: 'TIER_0' as const,
    status: 'MAJOR_OUTAGE' as const,
  },
  {
    id: 'search',
    name: 'Search',
    source: 'DEPENDENCY' as const,
    excluded: false,
    active: false,
    criticality: null,
    status: 'OPERATIONAL' as const,
  },
];

describe('IncidentImpacts', () => {
  it('shows tier and health on each chip, marks ended impacts, and explains the reason in a popover', async () => {
    render(<IncidentImpacts incidentId="i1" impacts={impacts} />);
    const list = screen.getByRole('list', { name: 'Affected business services' });
    const checkout = within(list).getByRole('button', { name: /Checkout/ });
    expect(checkout).toHaveTextContent('Tier 0');
    expect(checkout).toHaveAccessibleName(/Major outage: Its service is affected/);
    expect(within(list).getByRole('button', { name: /Search/ })).toHaveTextContent('ended');
    fireEvent.click(checkout);
    expect(await screen.findByText('Its service is affected.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open business service/ })).toHaveAttribute(
      'href',
      '/services/business/co'
    );
  });

  it('offers Undo after removing an impact', async () => {
    render(<IncidentImpacts incidentId="i1" impacts={impacts} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Not impacting Checkout' }));
    await waitFor(() => expect(actions.set).toHaveBeenCalledWith('i1', 'co', false));
    await waitFor(() => expect(notifyMock.success).toHaveBeenCalled());
    const [, options] = notifyMock.success.mock.calls[0];
    options.action.onClick();
    await waitFor(() => expect(actions.set).toHaveBeenLastCalledWith('i1', 'co', true));
  });

  it('shows tier and health in the picker', async () => {
    render(<IncidentImpacts incidentId="i1" impacts={[]} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Impacted business service/ }));
    const option = await screen.findByRole('option', { name: /Payments/ }, { timeout: 2000 });
    expect(option).toHaveTextContent('Degraded');
    expect(option).toHaveTextContent('Tier 1');
  });
});
