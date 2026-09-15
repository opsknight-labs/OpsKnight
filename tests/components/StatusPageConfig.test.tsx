import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import StatusPageConfig from '@/components/StatusPageConfig';

const notifySuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  notify: {
    success: (...args: unknown[]) => notifySuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const mockRefresh = vi.fn();

// Mock useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: vi.fn(),
  }),
}));

// Mock useTimezone
vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    browserTimeZone: 'UTC',
  }),
}));

// Mock sub-components
vi.mock('@/components/status-page/StatusPageLivePreview', () => ({
  default: () => <div data-testid="live-preview">Live Preview</div>,
}));

vi.mock('@/components/status-page/StatusPageHeader', () => ({
  default: () => <div>Header</div>,
}));

vi.mock('@/components/status-page/StatusPagePrivacySettings', () => ({
  default: () => <div>Privacy</div>,
}));

vi.mock('@/components/status-page/StatusPageWebhooksSettings', () => ({
  default: () => <div>Webhooks</div>,
}));

vi.mock('@/components/status-page/StatusPageSubscribers', () => ({
  default: () => <div>Subscribers</div>,
}));

vi.mock('@/components/status-page/StatusPageEmailConfig', () => ({
  default: () => <div>Email Config</div>,
}));

const mockStatusPage: React.ComponentProps<typeof StatusPageConfig>['statusPage'] = {
  id: 'sp-1',
  name: 'Test Page',
  organizationName: 'Test Org',
  subdomain: 'test',
  enabled: true,
  showServices: true,
  showIncidents: true,
  showMetrics: true,
  services: [],
  announcements: [],
  apiTokens: [],
  branding: {},
};

const mockAllServices: React.ComponentProps<typeof StatusPageConfig>['allServices'] = [
  { id: 'svc-1', name: 'Service 1' },
];

describe('StatusPageConfig Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sidebar navigation items', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    expect(screen.getByText(/General/)).toBeDefined();
    expect(screen.getByText(/Appearance/)).toBeDefined();
    expect(screen.getByText(/Design/)).toBeDefined();
  });

  it('renders the sticky save bar', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    expect(screen.getByText(/Save Settings/)).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('switches sections when sidebar items are clicked and allows color reset', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    const appearanceTab = screen.getByText('Appearance');
    fireEvent.click(appearanceTab);

    expect(screen.getByText('Branding & Logo')).toBeDefined();
    expect(screen.getByText('Color theme')).toBeDefined();
    expect(screen.getByText('Theme presets')).toBeDefined();
    expect(screen.getByText('Custom colors')).toBeDefined();
    expect(screen.getByText('Reset to default')).toBeDefined();

    // Click Reset to default
    fireEvent.click(screen.getByText('Reset to default'));
    expect(screen.getByText('Modern Light')).toBeDefined();
    expect(screen.getByText('Midnight Dark')).toBeDefined();
    expect(screen.queryByText('Light theme defaults')).toBeNull();
    expect(screen.queryByText('Dark theme defaults')).toBeNull();
    expect(screen.queryByText('Auto-pair text contrast')).toBeNull();
    expect(
      screen.getByText(
        'Contrast check passed. These colors will render unchanged on the public page.'
      )
    ).toBeDefined();
  });

  it('toggles live preview panel', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    // Use "Show Preview" as identified in the component
    const previewBtn = screen.getByText(/Show Preview/i);
    fireEvent.click(previewBtn);

    expect(screen.getByTestId('live-preview')).toBeDefined();
    expect(screen.getByText(/Hide Preview/i)).toBeDefined();
  });

  it('shows success message after successful save', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { updatedAt: new Date().toISOString(), publication: { status: 'LIVE' } },
        }),
    });

    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    const saveBtn = screen.getByText(/Save Settings/);
    fireEvent.click(saveBtn);

    // Success is centralized via the global toast. No ephemeral inline "saved" banner
    // — publication failure/pending is surfaced by the distinct persistent banner.
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
    expect(notifySuccess.mock.calls[0][0]).toMatch(/Settings saved/i);
    expect(notifySuccess.mock.calls[0][1]).toEqual(
      expect.objectContaining({ id: expect.stringContaining('status-page:') })
    );
  });

  it('saves authentication when Public Access is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { updatedAt: new Date().toISOString(), publication: { status: 'LIVE' } },
      }),
    });
    global.fetch = fetchMock;
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Public Access' }));
    fireEvent.click(screen.getByText(/Save Settings/));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());

    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(request).toBeDefined();
    expect(JSON.parse(request![1].body).requireAuth).toBe(true);
  });

  it('resets modified form draft and calls router.refresh when Cancel is clicked', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    const nameInput = screen.getByLabelText(/Page Name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Test Page');

    // User edits draft
    fireEvent.change(nameInput, { target: { value: 'Modified Draft Name' } });
    expect(nameInput.value).toBe('Modified Draft Name');

    // Click Cancel
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    // Draft is deterministically reset to original value and router.refresh() is called
    expect(nameInput.value).toBe('Test Page');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders delete status page button on the action bar and requires typing delete to confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;

    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    // 1. Delete button exists on the sticky card
    const deleteTrigger = screen.getByRole('button', { name: /delete status page/i });
    expect(deleteTrigger).toBeDefined();

    // 2. Click opens warning dialog
    fireEvent.click(deleteTrigger);
    expect(screen.getByRole('heading', { name: 'Delete Status Page' })).toBeDefined();
    expect(screen.getByText(/Permanently removes this page/i)).toBeDefined();

    // 3. Confirm button is disabled before typing "delete"
    const deleteBtns = screen.getAllByRole('button', { name: /delete status page/i });
    const confirmDeleteBtn = deleteBtns[deleteBtns.length - 1];
    expect(confirmDeleteBtn).toBeDisabled();

    // 4. Typing "delete" enables confirmation
    const matchInput = screen.getByPlaceholderText('delete');
    fireEvent.change(matchInput, { target: { value: 'delete' } });
    expect(confirmDeleteBtn).not.toBeDisabled();

    // 5. Clicking confirm triggers delete API
    fireEvent.click(confirmDeleteBtn);
    await waitFor(() => {
      const deleteReq = fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE');
      expect(deleteReq).toBeDefined();
      expect(deleteReq![0]).toContain('id=sp-1');
    });
  });

  it('saves auto-refresh in Advanced settings without being blocked by empty API token name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { updatedAt: new Date().toISOString(), publication: { status: 'LIVE' } },
      }),
    });
    global.fetch = fetchMock;

    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    // Navigate to Advanced tab
    const advancedTab = screen.getByText('Advanced');
    fireEvent.click(advancedTab);

    expect(screen.getByText('Live Updates & Feeds')).toBeDefined();

    // Auto-Refresh is enabled by default; refresh interval input is present
    const intervalInput = screen.getByLabelText(/Refresh Interval/i);
    expect(intervalInput).toBeDefined();
    fireEvent.change(intervalInput, { target: { value: '120' } });

    // The API token field is empty, but Save Settings should still succeed without form validation blockage
    const saveBtn = screen.getByText(/Save Settings/);
    fireEvent.click(saveBtn);

    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(request).toBeDefined();
    const payload = JSON.parse(request![1].body);
    expect(payload.branding.autoRefresh).toBe(true);
    expect(payload.branding.refreshInterval).toBe(120);
  });

  it('validates API token creation programmatically when token name is empty', async () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    fireEvent.click(screen.getByText('Advanced'));

    const createTokenBtn = screen.getByRole('button', { name: 'Create token' });
    fireEvent.click(createTokenBtn);

    // Shows programmatic validation error
    expect(screen.getByText('Token name is required.')).toBeDefined();
  });

  it('toggles Content section display options and verifies helper text', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    fireEvent.click(screen.getByText('Content'));

    expect(screen.getByText('Display Options')).toBeDefined();

    // Verify Show Services switch and clarified helper text
    const showServicesSwitch = screen.getByRole('switch', { name: 'Show Services' });
    expect(showServicesSwitch).toBeChecked();
    expect(screen.getByText(/disabling hides all service cards from the page/i)).toBeDefined();
    fireEvent.click(showServicesSwitch);
    expect(showServicesSwitch).not.toBeChecked();

    // Verify Show Incidents switch
    const showIncidentsSwitch = screen.getByRole('switch', { name: 'Show Incidents' });
    expect(showIncidentsSwitch).toBeChecked();
    fireEvent.click(showIncidentsSwitch);
    expect(showIncidentsSwitch).not.toBeChecked();

    // Verify Show Uptime & Availability switch
    const showUptimeSwitch = screen.getByRole('switch', { name: 'Show Uptime & Availability' });
    expect(showUptimeSwitch).toBeChecked();
    fireEvent.click(showUptimeSwitch);
    expect(showUptimeSwitch).not.toBeChecked();

    // Verify Show Region Heatmap switch is not disabled and toggles
    const heatmapSwitch = screen.getByRole('switch', { name: 'Show Region Heatmap' });
    expect(heatmapSwitch).not.toBeDisabled();
    expect(heatmapSwitch).toBeChecked();
    fireEvent.click(heatmapSwitch);
    expect(heatmapSwitch).not.toBeChecked();

    // Verify Show Subscribe to Updates switch
    const subscribeSwitch = screen.getByRole('switch', { name: 'Show Subscribe to Updates' });
    expect(subscribeSwitch).toBeChecked();
    fireEvent.click(subscribeSwitch);
    expect(subscribeSwitch).not.toBeChecked();
  });

  it('toggles Appearance section header and footer visibility switches', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    fireEvent.click(screen.getByText('Appearance'));

    const showHeaderSwitch = screen.getByRole('switch', { name: 'Show Header' });
    expect(showHeaderSwitch).toBeChecked();
    fireEvent.click(showHeaderSwitch);
    expect(showHeaderSwitch).not.toBeChecked();

    const showFooterSwitch = screen.getByRole('switch', { name: 'Show Footer' });
    expect(showFooterSwitch).toBeChecked();
    fireEvent.click(showFooterSwitch);
    expect(showFooterSwitch).not.toBeChecked();
  });
});
