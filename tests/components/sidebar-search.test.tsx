import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SidebarSearch from '@/components/SidebarSearch';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/contexts/IncidentCreationModalContext', () => ({
  useCreateIncidentModal: () => ({
    openCreateIncident: vi.fn(),
  }),
}));

describe('SidebarSearch component', () => {
  it('renders search input with resilient styling classes', () => {
    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });
    expect(input).toBeDefined();
    expect(input.className).toContain('search-input');
    expect(input.className).toContain('topbar-search-input');
  });

  it('displays matching navigation pages when searching', async () => {
    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });
    fireEvent.change(input, { target: { value: 'users' } });

    await waitFor(() => {
      expect(screen.getByText('Users')).toBeDefined();
      expect(screen.getByText('User directory & access roles')).toBeDefined();
    });
  });

  it('displays matching navigation for incidents', async () => {
    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });
    fireEvent.change(input, { target: { value: 'incidents' } });

    await waitFor(() => {
      expect(screen.getByText('Incidents')).toBeDefined();
    });
  });

  it('renders API search results for policies and postmortems without empty state', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            type: 'policy',
            id: 'pol-1',
            title: 'Critical Infra Escalation',
            subtitle: 'Escalation Policy',
            href: '/policies/pol-1',
          },
          {
            type: 'postmortem',
            id: 'pm-1',
            title: 'Postmortem for Database Outage',
            subtitle: 'Published',
            href: '/postmortems/inc-1',
          },
        ],
      }),
    } as unknown as Response);

    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });
    fireEvent.change(input, { target: { value: 'database outage' } });

    await waitFor(() => {
      expect(screen.getByText('Critical Infra Escalation')).toBeDefined();
      expect(screen.getByText('Postmortem for Database Outage')).toBeDefined();
    });

    global.fetch = originalFetch;
  });

  it('opens and displays quick actions on the first click or focus without requiring a second click', async () => {
    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Quick Actions')).toBeDefined();
      expect(screen.getByText('Create new incident')).toBeDefined();
      expect(screen.getByText('Go to')).toBeDefined();
      expect(screen.getByText('Escalation Policies')).toBeDefined();
    });
  });

  it('clears stale results immediately on query change and does not show old results while fetching', async () => {
    const originalFetch = global.fetch;
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    // First query response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            type: 'service',
            id: 'svc-old',
            title: 'Legacy Auth Service',
            href: '/services/svc-old',
          },
        ],
      }),
    } as unknown as Response);

    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });

    // Type first query
    fireEvent.change(input, { target: { value: 'auth' } });

    await waitFor(() => {
      expect(screen.getByText('Legacy Auth Service')).toBeDefined();
    });

    // Make second query hang / stay pending
    let resolveSecondQuery: (val: unknown) => void = () => {};
    const pendingPromise = new Promise(resolve => {
      resolveSecondQuery = resolve;
    });
    mockFetch.mockReturnValueOnce(pendingPromise);

    // Type new query
    fireEvent.change(input, { target: { value: 'payment' } });

    // Stale result must immediately disappear and searching loader should show
    expect(screen.queryByText('Legacy Auth Service')).toBeNull();
    expect(screen.getByText('Searching...')).toBeDefined();

    // Resolve second query to clean up
    resolveSecondQuery({
      ok: true,
      json: async () => ({ results: [] }),
    });

    global.fetch = originalFetch;
  });

  it('offers Go to commands only for pages the person can open', async () => {
    render(<SidebarSearch role="USER" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Incidents')).toBeDefined();
    });
    expect(screen.queryByText('Escalation Policies')).toBeNull();
    expect(screen.queryByText('Users')).toBeNull();
  });

  it('shows a visible no-results state for short and long queries', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as unknown as Response);

    render(<SidebarSearch role="ADMIN" />);
    const input = screen.getByRole('combobox', { name: 'Search or go to a page' });

    fireEvent.change(input, { target: { value: '~' } });
    await waitFor(() => {
      expect(screen.getByText('No results for “~”')).toBeDefined();
      expect(screen.getByText(/at least 2 characters/)).toBeDefined();
    });

    fireEvent.change(input, { target: { value: 'zzqqzz' } });
    await waitFor(() => {
      expect(screen.getByText('No results for “zzqqzz”')).toBeDefined();
    });

    global.fetch = originalFetch;
  });
});
