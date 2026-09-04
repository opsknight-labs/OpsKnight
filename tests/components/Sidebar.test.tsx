import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import { SidebarProvider } from '@/contexts/SidebarContext';
import BrandLockup from '@/components/layout/BrandLockup';
import SidebarTrigger from '@/components/layout/SidebarTrigger';

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

  it('renders Event Logs and Audit Log only for ADMIN role', async () => {
    const { unmount } = renderWithProvider(
      <Sidebar userName="Admin User" userEmail="admin@example.com" userRole="ADMIN" />
    );

    await waitFor(() => {
      expect(screen.getByText('Event Logs')).toBeInTheDocument();
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });

    unmount();

    renderWithProvider(
      <Sidebar userName="Responder User" userEmail="responder@example.com" userRole="RESPONDER" />
    );

    await waitFor(() => {
      expect(screen.queryByText('Event Logs')).not.toBeInTheDocument();
      expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
    });
  });

  it('hides Event Logs and Audit Log for standard USER role', async () => {
    renderWithProvider(
      <Sidebar userName="Regular User" userEmail="user@example.com" userRole="USER" />
    );

    await waitFor(() => {
      expect(screen.queryByText('Event Logs')).not.toBeInTheDocument();
      expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
    });
  });
});
