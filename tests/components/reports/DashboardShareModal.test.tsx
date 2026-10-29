import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DashboardShareModal from '@/components/reports/DashboardShareModal';

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DashboardShareModal Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    dashboardId: 'dash-test-1',
    dashboardName: 'Production SRE Dashboard',
    isTemplate: false,
    currentVisibility: 'PRIVATE' as const,
    currentFilters: {
      windowDays: 14,
      teamId: 'team-sre',
      serviceId: 'svc-payments',
    },
    onVisibilityChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders full shareable URL with current active filters', () => {
    render(<DashboardShareModal {...defaultProps} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toContain('/reports/executive/dash-test-1');
    expect(input.value).toContain('window=14');
    expect(input.value).toContain('teamId=team-sre');
    expect(input.value).toContain('serviceId=svc-payments');
  });

  it('copies share link and shows copied confirmation', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DashboardShareModal {...defaultProps} />);

    const copyBtn = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/reports/executive/dash-test-1'));
      expect(screen.getByText('Copied')).toBeDefined();
    });
  });

  it('allows switching visibility and calls PUT /api/dashboards/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;

    render(<DashboardShareModal {...defaultProps} />);

    const teamBtn = screen.getByText('Team').closest('button');
    expect(teamBtn).toBeDefined();
    fireEvent.click(teamBtn!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dashboards/dash-test-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ visibility: 'TEAM' }),
        })
      );
      expect(defaultProps.onVisibilityChange).toHaveBeenCalledWith('TEAM');
    });
  });

  it('displays template explanation badge when isTemplate is true', () => {
    render(
      <DashboardShareModal
        {...defaultProps}
        isTemplate={true}
        dashboardId={undefined}
      />
    );

    expect(screen.getByText('Template')).toBeDefined();
    expect(
      screen.getByText(/Share a direct link to "Production SRE Dashboard"/i)
    ).toBeDefined();
    // Saved permissions should not be rendered for built-in template
    expect(screen.queryByText('Access Permissions')).toBeNull();
  });
});
