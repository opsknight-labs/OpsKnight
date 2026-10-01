import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import DashboardViewer from '@/app/(app)/reports/executive/DashboardViewer';
import type { SerializedSLAMetrics } from '@/lib/sla';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/reports/DashboardGrid', () => ({
  default: ({
    widgets,
    isEditing,
    onRemoveWidget,
  }: {
    widgets: Array<{ id: string }>;
    isEditing: boolean;
    onRemoveWidget: (id: string) => void;
  }) => (
    <div data-testid="dashboard-grid">
      <span>{widgets.length} widgets in grid</span>
      {isEditing && (
        <button
          data-testid="remove-widget-btn"
          onClick={() => widgets[0] && onRemoveWidget(widgets[0].id)}
        >
          Remove First
        </button>
      )}
    </div>
  ),
}));

describe('DashboardViewer Component', () => {
  const mockWidgets = [
    {
      id: 'w-1',
      widgetType: 'metric',
      metricKey: 'totalIncidents',
      widgetDefinitionId: 'total-incidents',
      title: 'Total Incidents',
      position: { x: 0, y: 0, w: 1, h: 1 },
      config: {},
    },
    {
      id: 'w-2',
      widgetType: 'chart',
      metricKey: 'trendSeries',
      widgetDefinitionId: 'incident-trend',
      title: 'Incident Trend',
      position: { x: 1, y: 0, w: 2, h: 2 },
      config: { chartType: 'count' },
    },
  ];

  const defaultProps = {
    dashboardName: 'Executive Operations',
    dashboardDescription: 'High level reliability overview',
    widgets: mockWidgets,
    metrics: {} as SerializedSLAMetrics,
    lastUpdated: 'Sep 30, 2026, 09:00 AM',
    currentFilters: { windowDays: 7 },
    filterOptions: {
      teams: [{ id: 'team-infra', name: 'Infrastructure' }],
      services: [{ id: 'svc-db', name: 'Database' }],
    },
    templates: [
      {
        id: 'sre-ops',
        name: 'SRE Operations',
        description: 'SRE metrics',
        icon: 'Terminal',
        color: '#10b981',
        widgets: [],
      },
    ],
    savedDashboards: [
      { id: 'dash-456', name: 'SRE Dashboard', visibility: 'PRIVATE', userId: 'user-1' },
    ],
    currentUserId: 'user-1',
    isTemplate: false,
    dashboardId: 'dash-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.hasPointerCapture = () => false;
    window.HTMLElement.prototype.setPointerCapture = () => {};
    window.HTMLElement.prototype.releasePointerCapture = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
  });

  it('renders dashboard details and initial widget count', () => {
    render(<DashboardViewer {...defaultProps} />);

    expect(screen.getByText('Executive Operations')).toBeDefined();
    expect(screen.getByText('High level reliability overview')).toBeDefined();
    expect(screen.getByText('2 widgets')).toBeDefined();
  });

  it('preserves dashboardId in filter navigation URL for custom dashboards', async () => {
    render(<DashboardViewer {...defaultProps} />);

    // Open teams select
    const teamTrigger = screen.getByRole('combobox', { name: /filter by team/i });
    fireEvent.keyDown(teamTrigger, { key: 'ArrowDown' });

    const teamOption = await screen.findByText('Infrastructure');
    fireEvent.click(teamOption);

    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('/reports/executive/dash-123')
    );
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('teamId=team-infra')
    );
  });

  it('navigates to another saved dashboard when chosen from selector', async () => {
    render(<DashboardViewer {...defaultProps} />);

    // Find dashboard selector trigger
    const selectorTrigger = screen.getByRole('combobox', { name: /select dashboard/i });
    fireEvent.keyDown(selectorTrigger, { key: 'ArrowDown' });

    const targetOption = await screen.findByText('SRE Dashboard');
    fireEvent.click(targetOption);

    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('/reports/executive/dash-456')
    );
  });

  it('enters edit mode, renames dashboard, tracks dirty state, and saves via PUT API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        dashboard: {
          id: 'dash-123',
          widgets: [mockWidgets[1]],
          name: 'Renamed Operations',
          description: 'Updated description',
        },
      }),
    });
    global.fetch = fetchMock;

    render(<DashboardViewer {...defaultProps} />);

    // Open settings dropdown to edit
    const settingsButton = screen.getByRole('button', { name: 'Dashboard settings' });
    fireEvent.pointerDown(settingsButton, { button: 0 });

    const editMenuItem = await screen.findByText(/Edit Dashboard/i);
    fireEvent.click(editMenuItem);

    // Edit bar should be visible
    expect(screen.getByText(/Editing mode - 2 widgets/i)).toBeDefined();

    // Rename dashboard via title input
    const titleInput = screen.getByPlaceholderText('Dashboard title');
    fireEvent.change(titleInput, { target: { value: 'Renamed Operations' } });

    // Trigger widget removal from mocked grid
    const removeBtn = screen.getByTestId('remove-widget-btn');
    fireEvent.click(removeBtn);

    // Unsaved changes indicator should appear
    expect(screen.getByText('Unsaved changes')).toBeDefined();
    expect(screen.getByText(/Editing mode - 1 widgets/i)).toBeDefined();

    // Click Save Changes
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dashboards/dash-123',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"name":"Renamed Operations"'),
        })
      );
    });
  });

  it('restores saved baseline and title when Cancel is clicked in edit mode', async () => {
    render(<DashboardViewer {...defaultProps} />);

    // Enter edit mode
    const settingsButton = screen.getByRole('button', { name: 'Dashboard settings' });
    fireEvent.pointerDown(settingsButton, { button: 0 });
    const editMenuItem = await screen.findByText(/Edit Dashboard/i);
    fireEvent.click(editMenuItem);

    // Edit title
    const titleInput = screen.getByPlaceholderText('Dashboard title');
    fireEvent.change(titleInput, { target: { value: 'Scratch Title' } });

    // Remove widget to make dirty
    const removeBtn = screen.getByTestId('remove-widget-btn');
    fireEvent.click(removeBtn);
    expect(screen.getByText('Unsaved changes')).toBeDefined();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    // Should exit edit mode and restore title
    expect(screen.queryByText(/Editing mode/i)).toBeNull();
    expect(screen.getByText('Executive Operations')).toBeDefined();
  });

  it('renders editing footer with dashboard-edit-footer class and opens widget library via Add Widget button', async () => {
    const { container } = render(<DashboardViewer {...defaultProps} />);

    // Enter edit mode
    const settingsButton = screen.getByRole('button', { name: 'Dashboard settings' });
    fireEvent.pointerDown(settingsButton, { button: 0 });
    const editMenuItem = await screen.findByText(/Edit Dashboard/i);
    fireEvent.click(editMenuItem);

    // Verify footer has dashboard-edit-footer class to respect sidebar offset
    const editFooter = screen.getByTestId('dashboard-edit-footer');
    expect(editFooter).toBeDefined();
    expect(editFooter.className).toContain('dashboard-edit-footer');

    // Verify container has bottom padding to prevent content overlap
    const rootContainer = container.firstElementChild as HTMLElement;
    expect(rootContainer.className).toContain('pb-28');

    // Click Add Widget in footer
    const addWidgetButton = screen.getByRole('button', { name: /add widget/i });
    fireEvent.click(addWidgetButton);

    // Widget Library modal should open
    expect(screen.getByText('Widget Library')).toBeDefined();
    expect(screen.getByText('Choose widgets to add to your dashboard')).toBeDefined();
  });

  it('triggers window.print when Export PDF is clicked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<DashboardViewer {...defaultProps} />);

    const exportBtn = screen.getByRole('button', { name: /export pdf/i });
    fireEvent.click(exportBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it('opens Share modal when Share button is clicked', () => {
    render(<DashboardViewer {...defaultProps} />);

    const shareBtn = screen.getByRole('button', { name: /^share$/i });
    fireEvent.click(shareBtn);

    expect(screen.getByText('Share Dashboard')).toBeDefined();
    expect(screen.getByText(/Current filter parameters/i)).toBeDefined();
  });

  it('toggles Kiosk presentation mode when Presentation button is clicked', () => {
    render(<DashboardViewer {...defaultProps} />);

    const presentationBtn = screen.getByTitle(/Presentation Mode \(Press F\)/i);
    fireEvent.click(presentationBtn);

    expect(screen.getByText('NOC Wallboard')).toBeDefined();
    expect(screen.getByRole('button', { name: /Exit \(Esc\)/i })).toBeDefined();

    // Exit Kiosk mode
    fireEvent.click(screen.getByRole('button', { name: /Exit \(Esc\)/i }));
    expect(screen.queryByText('NOC Wallboard')).toBeNull();
  });
});

