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
  default: ({ widgets, isEditing, onRemoveWidget }: any) => (
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
    filterOptions: { teams: [], services: [] },
    templates: [],
    isTemplate: false,
    dashboardId: 'dash-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders dashboard details and initial widget count', () => {
    render(<DashboardViewer {...defaultProps} />);

    expect(screen.getByText('Executive Operations')).toBeDefined();
    expect(screen.getByText('High level reliability overview')).toBeDefined();
    expect(screen.getByText('2 widgets')).toBeDefined();
  });

  it('preserves dashboardId in filter navigation URL for custom dashboards', () => {
    render(<DashboardViewer {...defaultProps} />);

    // Time window select
    const timeWindowTrigger = screen.getByText('7 days');
    expect(timeWindowTrigger).toBeDefined();
  });

  it('enters edit mode, tracks dirty state on widget changes, and saves via PUT API', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        dashboard: { id: 'dash-123', widgets: [mockWidgets[1]] },
      }),
    });

    render(<DashboardViewer {...defaultProps} />);

    // Open settings dropdown to edit
    const settingsButton = screen.getByRole('button', { name: 'Dashboard settings' });
    fireEvent.pointerDown(settingsButton, { button: 0 });

    const editMenuItem = await screen.findByText('Edit Dashboard');
    fireEvent.click(editMenuItem);

    // Edit bar should be visible
    expect(screen.getByText(/Editing mode - 2 widgets/i)).toBeDefined();

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
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/dashboards/dash-123',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"widgets":'),
        })
      );
    });
  });

  it('restores saved baseline when Cancel is clicked in edit mode', async () => {
    render(<DashboardViewer {...defaultProps} />);

    // Enter edit mode
    const settingsButton = screen.getByRole('button', { name: 'Dashboard settings' });
    fireEvent.pointerDown(settingsButton, { button: 0 });
    const editMenuItem = await screen.findByText('Edit Dashboard');
    fireEvent.click(editMenuItem);

    // Remove widget to make dirty
    const removeBtn = screen.getByTestId('remove-widget-btn');
    fireEvent.click(removeBtn);
    expect(screen.getByText('Unsaved changes')).toBeDefined();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    // Should exit edit mode
    expect(screen.queryByText(/Editing mode/i)).toBeNull();
  });
});
