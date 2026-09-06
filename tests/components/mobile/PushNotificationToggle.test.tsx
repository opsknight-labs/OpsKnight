import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PushNotificationToggle from '@/components/mobile/PushNotificationToggle';

const mockFetch = vi.fn();

describe('PushNotificationToggle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    Object.defineProperty(window, 'PushManager', {
      value: function PushManager() {},
      configurable: true,
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({}),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a test push when clicking the test button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'Test push sent. Check your device.' }),
    });

    render(<PushNotificationToggle />);

    const button = await screen.findByRole('button', { name: /Send test push/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/notifications/test-push', { method: 'POST' });
    });
  });
});
