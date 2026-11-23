import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import { SidebarProvider } from '@/contexts/SidebarContext';
import BrandLockup from '@/components/layout/BrandLockup';
import SidebarTrigger from '@/components/layout/SidebarTrigger';

const mockRealtimeMetrics = vi.hoisted(() => ({ current: null as { active?: number } | null }));
const mockPathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname.current,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => ({
    isConnected: true,
    metrics: mockRealtimeMetrics.current,
    recentIncidents: [],
    error: null,
  }),
}));

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const mockFetch = () => {
  global.fetch = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({ activeIncidentsCount: 0 }),
  } as unknown as Response);
};

// Helper to render with provider
const renderWithProvider = (ui: React.ReactElement) => {
  return render(
    <SessionProvider session={null}>
      <SidebarProvider>
        <header>
          <BrandLockup />
          <SidebarTrigger />
        </header>
        {ui}
      </SidebarProvider>
    </SessionProvider>
  );
};

describe('Sidebar', () => {
  beforeEach(() => {
    mockRealtimeMetrics.current = null;
    mockPathname.current = '/';
    mockMatchMedia(false);
    mockFetch();
    localStorage.clear();
  });

  it('renders expanded by default', async () => {
    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('renders the brand title correctly', () => {
    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    const heading = screen.getByRole('heading', { name: /OpsKnight/i });
    expect(heading).toBeInTheDocument();
  });

  it('honors collapsed state from localStorage', async () => {
    localStorage.setItem('sidebarCollapsed', '1');

    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    await waitFor(() => {
      // When collapsed, text labels are hidden
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });
  });

  it('toggles collapse state and persists it', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );
    setItemSpy.mockClear();

    // Find the collapse toggle button (original sidebar has << / >> toggle)
    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i });
    fireEvent.click(collapseButton);

    await waitFor(() => {
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
      expect(setItemSpy).toHaveBeenCalledWith('sidebarCollapsed', '1');
    });

    const expandButton = screen.getByRole('button', { name: /expand sidebar/i });
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(setItemSpy).toHaveBeenCalledWith('sidebarCollapsed', '0');
    });
  });

  it('renders Event logs and Audit log only for ADMIN role', async () => {
    const { unmount } = renderWithProvider(
      <Sidebar userName="Admin User" userEmail="admin@example.com" userRole="ADMIN" />
    );

    await waitFor(() => {
      expect(screen.getByText('Event logs')).toBeInTheDocument();
      expect(screen.getByText('Audit log')).toBeInTheDocument();
    });

    unmount();

    renderWithProvider(
      <Sidebar userName="Responder User" userEmail="responder@example.com" userRole="RESPONDER" />
    );

    await waitFor(() => {
      expect(screen.queryByText('Event logs')).not.toBeInTheDocument();
      expect(screen.queryByText('Audit log')).not.toBeInTheDocument();
    });
  });

  it('hides Event logs and Audit log for standard USER role', async () => {
    renderWithProvider(
      <Sidebar userName="Regular User" userEmail="user@example.com" userRole="USER" />
    );

    await waitFor(() => {
      expect(screen.queryByText('Event logs')).not.toBeInTheDocument();
      expect(screen.queryByText('Audit log')).not.toBeInTheDocument();
    });
  });

  it('renders initial active incident count badge immediately without waiting for fetch', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    renderWithProvider(
      <Sidebar
        userName="Alex Doe"
        userEmail="alex@example.com"
        userRole="ADMIN"
        initialActiveCount={42}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('never fetches sidebar data on render', () => {
    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders status-page metadata supplied by the server shell', () => {
    renderWithProvider(
      <Sidebar
        userName="Alex Doe"
        userEmail="alex@example.com"
        userRole="ADMIN"
        initialStatusPages={[
          { id: 'status-1', name: 'Public Status', slug: 'public', isDefault: false },
        ]}
        initialIsStatusPageAdmin
      />
    );

    expect(screen.getByText('Public Status')).toBeInTheDocument();
  });

  it('groups pages by job, in order, with public status pages under Status', () => {
    const { container } = renderWithProvider(
      <Sidebar
        userName="Alex Doe"
        userEmail="alex@example.com"
        userRole="ADMIN"
        initialStatusPages={[
          { id: 'status-1', name: 'Public Status', slug: 'public', isDefault: false },
        ]}
      />
    );

    const sections = [...container.querySelectorAll('[data-section]')].map(node =>
      node.getAttribute('data-section')
    );
    expect(sections).toEqual([
      'MAIN',
      'RESPOND',
      'CATALOG',
      'STATUS',
      'ON_CALL',
      'LEARN',
      'INSIGHTS',
      'ORGANIZATION',
    ]);
    const status = container.querySelector('[data-section="STATUS"]')!;
    expect(status.textContent).toContain('Status dashboard');
    expect(status.textContent).toContain('Public Status');
    expect(container.querySelector('[data-section="CATALOG"]')!.textContent).toContain(
      'Service graph'
    );
  });

  it('folds a section from its header and remembers it', async () => {
    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    const learn = screen.getByRole('button', { name: 'Learn' });
    expect(learn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(learn);

    await waitFor(() => expect(screen.queryByText('Postmortems')).not.toBeInTheDocument());
    expect(learn).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(localStorage.getItem('opsknight:sidebar-folded-sections')!)).toEqual([
      'LEARN',
    ]);

    fireEvent.click(learn);
    await waitFor(() => expect(screen.getByText('Postmortems')).toBeInTheDocument());
  });

  it('keeps a folded section folded after a reload', () => {
    localStorage.setItem('opsknight:sidebar-folded-sections', JSON.stringify(['LEARN']));
    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    expect(screen.queryByText('Postmortems')).not.toBeInTheDocument();
    expect(screen.getByText('Schedules')).toBeInTheDocument();
  });

  it('never folds the section holding the current page', () => {
    localStorage.setItem('opsknight:sidebar-folded-sections', JSON.stringify(['LEARN']));
    mockPathname.current = '/postmortems/inc-1';
    renderWithProvider(
      <Sidebar userName="Alex Doe" userEmail="alex@example.com" userRole="ADMIN" />
    );

    expect(screen.getByText('Postmortems')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Learn' })).not.toBeInTheDocument();
  });
});
