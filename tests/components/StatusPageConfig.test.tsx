import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import StatusPageConfig from '@/components/StatusPageConfig';

// Mock useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
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

  it('renders sidebar with emoji icons', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    expect(screen.getByText(/General/)).toBeDefined();
    expect(screen.getByText(/⚙️/)).toBeDefined();
    expect(screen.getByText(/Appearance/)).toBeDefined();
    expect(screen.getByText(/🎨/)).toBeDefined();
    expect(screen.getByText(/Custom CSS/)).toBeDefined();
    expect(screen.getByText(/🖌️/)).toBeDefined();
  });

  it('renders the sticky save bar', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    expect(screen.getByText(/Save Settings/)).toBeDefined();
    expect(screen.getByText(/💾/)).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('switches sections when sidebar items are clicked', () => {
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    const appearanceTab = screen.getByText('Appearance');
    fireEvent.click(appearanceTab);

    expect(screen.getByText('Branding & Logo')).toBeDefined();
    expect(screen.getByText('Color theme')).toBeDefined();
    expect(screen.getByText('Theme presets')).toBeDefined();
    expect(screen.getByText('Custom colors')).toBeDefined();
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
      json: () => Promise.resolve({ success: true }),
    });

    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    const saveBtn = screen.getByText(/Save Settings/);
    fireEvent.click(saveBtn);

    // Success message is rendered in a div with specific colors
    const successMsg = await screen.findByText(/Settings saved successfully/i);
    expect(successMsg).toBeDefined();
  });

  it('saves authentication when Public Access is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;
    render(<StatusPageConfig statusPage={mockStatusPage} allServices={mockAllServices} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Public Access' }));
    fireEvent.click(screen.getByText(/Save Settings/));
    await screen.findByText(/Settings saved successfully/i);

    const request = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(request).toBeDefined();
    expect(JSON.parse(request![1].body).requireAuth).toBe(true);
  });
});
