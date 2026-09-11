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
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input).toBeDefined();
    expect(input.className).toContain('search-input');
    expect(input.className).toContain('topbar-search-input');
  });

  it('displays matching navigation pages when searching', async () => {
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'users' } });

    await waitFor(() => {
      expect(screen.getByText('Users')).toBeDefined();
      expect(screen.getByText('User directory & access roles')).toBeDefined();
    });
  });

  it('displays matching navigation for incidents', async () => {
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search...');
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

    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'database outage' } });

    await waitFor(() => {
      expect(screen.getByText('Critical Infra Escalation')).toBeDefined();
      expect(screen.getByText('Postmortem for Database Outage')).toBeDefined();
    });

    global.fetch = originalFetch;
  });
});
