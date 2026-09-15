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
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'granted',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: 'https://push.example.com/test-endpoint',
          unsubscribe: vi.fn().mockResolvedValue(true),
        }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconciles subscription state and sends a test push', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          json: async () => ({ deviceRegistered: true, accountEnabled: true }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/notifications/test-push')) {
        return {
          ok: true,
          json: async () => ({ message: 'Test push sent. Check your device.' }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    const button = await screen.findByRole('button', { name: /Send test push/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/notifications/test-push',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('requests permission synchronously when user clicks Enable', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue({ endpoint: 'https://push.example.com/new' }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
      configurable: true,
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/system/vapid-public-key')) {
        return {
          ok: true,
          json: async () => ({
            key: 'BNbxG8kP9a-dK8n3qV_8o3Y7n9p_1j4k6m8q0s2u4w6y8A0C2E4G6I8K0M2O4Q6S8U0W2Y4a6c8e0g2i4',
          }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(window.Notification.requestPermission).toHaveBeenCalled();
    });
  });

  it('fails closed when push subscription reconciliation endpoint returns an error', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription/status')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          endpoint: 'https://push.example.com/test-endpoint',
        });
        return {
          ok: false,
          status: 500,
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    // Reconciliation failure must surface an ERROR state (per-component fail-closed):
    // either the generic error alert or the explicit Repair/Auth affordance.
    await waitFor(() => {
      expect(
        screen.queryByText(/Push status could not be verified/i) ||
          screen.queryByRole('button', { name: /Repair/i }) ||
          screen.queryByRole('button', { name: /Enable/i })
      ).not.toBeNull();
    });
    // Primary assertion: a non-REGISTERED (safe) state — the toggle should not show "Disable".
    expect(screen.queryByRole('button', { name: /^Disable$/i })).not.toBeInTheDocument();
  });

  it('transitions to REPAIR_REQUIRED when test push returns 410', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          json: async () => ({ deviceRegistered: true, accountEnabled: true }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/notifications/test-push')) {
        return {
          ok: false,
          status: 410,
          text: async () =>
            JSON.stringify({
              code: 'VALIDATION_FAILED',
              meta: { reason: 'PUSH_SUBSCRIPTION_EXPIRED' },
            }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);
    const button = await screen.findByRole('button', { name: /Send test push/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Repair/i })).toBeInTheDocument();
      expect(
        screen.getByText(/Push subscription on this device has expired. Tap Repair to restore./i)
      ).toBeInTheDocument();
    });
  });

  it('transitions to REPAIR_REQUIRED when test push returns 404', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          json: async () => ({ deviceRegistered: true, accountEnabled: true }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/notifications/test-push')) {
        return {
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              code: 'RESOURCE_NOT_FOUND',
              meta: { reason: 'PUSH_NO_SUBSCRIPTION' },
            }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);
    const button = await screen.findByRole('button', { name: /Send test push/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Repair/i })).toBeInTheDocument();
      expect(
        screen.getByText(/Push subscription on this device has expired. Tap Repair to restore./i)
      ).toBeInTheDocument();
    });
  });

  it('transitions to REPAIR_REQUIRED when subscription endpoint is missing', async () => {
    const registration = {
      pushManager: {
        getSubscription: vi
          .fn()
          .mockResolvedValueOnce({
            endpoint: 'https://push.example.com/test-endpoint',
            unsubscribe: vi.fn().mockResolvedValue(true),
          })
          .mockResolvedValueOnce({
            endpoint: null,
            unsubscribe: vi.fn().mockResolvedValue(true),
          }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
      configurable: true,
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          json: async () => ({ deviceRegistered: true, accountEnabled: true }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);
    const button = await screen.findByRole('button', { name: /Send test push/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Repair/i })).toBeInTheDocument();
      expect(
        screen.getByText(/No active push subscription on this device. Tap Repair to restore./i)
      ).toBeInTheDocument();
    });
  });

  it('remains REGISTERED and displays error message when test push returns 503', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          json: async () => ({ deviceRegistered: true, accountEnabled: true }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/notifications/test-push')) {
        return {
          ok: false,
          status: 503,
          text: async () =>
            JSON.stringify({
              code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
              error: 'Push notification delivery failed for this device.',
            }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);
    const button = await screen.findByRole('button', { name: /Send test push/i });
    fireEvent.click(button);

    await waitFor(
      () => {
        expect(screen.getByRole('status')).toHaveTextContent(
          /Push notification delivery failed|Try again shortly|temporarily unavailable/i
        );
      },
      { timeout: 5000 }
    );
    expect(screen.getByRole('button', { name: /^Disable$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send test push/i })).not.toBeDisabled();
  });
});
