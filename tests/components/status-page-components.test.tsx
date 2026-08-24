import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StatusPageSubscribe from '@/components/status-page/StatusPageSubscribe';

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
});
