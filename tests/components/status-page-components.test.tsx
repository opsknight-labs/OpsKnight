import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StatusPageSubscribe from '@/components/status-page/StatusPageSubscribe';
import StatusPageSubscribeModal from '@/components/status-page/StatusPageSubscribeModal';
import StatusPageFooter from '@/components/status-page/StatusPageFooter';

// Mock fetch for subscribe tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StatusPageSubscribe', () => {
  it('renders the subscription form with email input and submit button', () => {
    render(<StatusPageSubscribe statusPageId="sp-123" />);
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeDefined();
  });

  it('shows validation error for invalid email', async () => {
    render(<StatusPageSubscribe statusPageId="sp-123" />);
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    const form = emailInput.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeDefined();
    });
  });

  it('shows validation error for empty email', async () => {
    render(<StatusPageSubscribe statusPageId="sp-123" />);
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: '' } });
    const form = emailInput.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeDefined();
    });
  });

  it('calls the subscribe API with correct payload on valid submit', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<StatusPageSubscribe statusPageId="sp-456" onSuccess={vi.fn()} />);
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    const form = emailInput.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/status-page/subscribe',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ statusPageId: 'sp-456', email: 'test@example.com' }),
        })
      );
    });
  });

  it('supports selecting specific services and submitting preferences', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const services = [
      { id: 'srv-1', name: 'API Gateway' },
      { id: 'srv-2', name: 'Database' },
    ];
    render(<StatusPageSubscribe statusPageId="sp-456" services={services} />);

    // Toggle to Selected services
    const selectedServicesBtn = screen.getByRole('button', { name: /selected services/i });
    fireEvent.click(selectedServicesBtn);

    // Try submitting without selecting any service
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    const form = emailInput.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/select at least one service/i)).toBeDefined();
    });

    // Select API Gateway service
    const serviceCheckbox = screen.getByRole('checkbox', { name: /api gateway/i });
    fireEvent.click(serviceCheckbox);

    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/status-page/subscribe',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            statusPageId: 'sp-456',
            email: 'test@example.com',
            preferences: { selectedServiceIds: ['srv-1'] },
          }),
        })
      );
    });
  });

  it('shows error message when API returns an error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Already subscribed' }),
    });
    render(<StatusPageSubscribe statusPageId="sp-123" />);
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: 'dupe@example.com' } });
    const form = emailInput.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText(/already subscribed/i)).toBeDefined();
    });
  });

  it('shows success message and allows dismiss', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<StatusPageSubscribe statusPageId="sp-123" />);
    const emailInput = screen.getByRole('textbox');
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    fireEvent.submit(emailInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/check your inbox|check your email/i)).toBeDefined();
    });

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByText(/check your inbox|check your email/i)).toBeNull();
    expect(screen.getByRole('textbox')).toBeDefined();
  });
});

describe('StatusPageSubscribeModal', () => {
  it('does not render when open is false', () => {
    const { container } = render(
      <StatusPageSubscribeModal
        open={false}
        statusPageId="sp-123"
        services={[]}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal dialog when open is true and calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <StatusPageSubscribeModal
        open={true}
        statusPageId="sp-123"
        services={[{ id: 's1', name: 'Web App' }]}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('heading', { name: /subscribe to updates/i })).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('StatusPageFooter', () => {
  it('renders default footer text, live pulse indicator, and powered by badge', () => {
    render(<StatusPageFooter links={{ resources: [], support: [] }} />);
    expect(screen.getByText(/real-time incident & telemetry updates/i)).toBeDefined();
    expect(
      screen.getByText(/status, incident communication, and real-time availability tracking/i)
    ).toBeDefined();
    expect(screen.getByRole('link', { name: /powered by opsknight/i })).toBeDefined();
    expect(screen.getByText(/create your status page/i)).toBeDefined();
    const logoImg = screen
      .getByRole('link', { name: /powered by opsknight/i })
      .querySelector('img');
    expect(logoImg?.getAttribute('src')).toBe('/logo.svg');
  });

  it('renders custom footerText and resource/support pill links with icons', () => {
    render(
      <StatusPageFooter
        footerText="Custom company uptime status message."
        links={{
          resources: [
            { href: '/api/v1/status', label: 'JSON API' },
            { href: '/status/rss', label: 'RSS Feed' },
          ],
          support: [{ href: 'https://help.example.com', label: 'Help Desk' }],
        }}
      />
    );

    expect(screen.getByText('Custom company uptime status message.')).toBeDefined();
    expect(screen.getByRole('link', { name: /json api/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /rss feed/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /help desk/i })).toBeDefined();
  });
});
