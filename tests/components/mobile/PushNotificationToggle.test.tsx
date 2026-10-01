import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PushNotificationToggle from '@/components/mobile/PushNotificationToggle';

const mockFetch = vi.fn();

describe('PushNotificationToggle', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
    vi.restoreAllMocks();
    delete (navigator as Navigator & { standalone?: boolean }).standalone;
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
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/notifications/test-push',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows server unavailable and still lets the user remove the device subscription', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscription = {
      endpoint: 'https://push.example.com/test-endpoint',
      unsubscribe,
    };
    const registration = {
      pushManager: {
        getSubscription: vi
          .fn()
          .mockResolvedValueOnce(subscription)
          .mockResolvedValueOnce(subscription)
          .mockResolvedValueOnce(null),
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

    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            deviceRegistered: true,
            accountEnabled: true,
            providerConfigured: false,
          }),
        };
      }
      if (
        typeof url === 'string' &&
        url.includes('/api/user/push-subscription') &&
        init?.method === 'DELETE'
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, remainingDevices: 0 }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/system/vapid-public-key')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: 'Push notifications are not configured on this server.',
            code: 'PUSH_VAPID_NOT_CONFIGURED',
            action: 'Push is not configured by your administrator.',
            retryable: false,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<PushNotificationToggle />);

    await waitFor(() => {
      expect(screen.getByText('Server unavailable')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Server Push configuration is unavailable. Your device subscription is still saved./i
        )
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remove this device/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Send test push/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Remove this device/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/user/push-subscription',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Remove this device/i })).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Push is not configured by your administrator.'
      );
    });
  });

  it('subscribes directly from the Enable gesture on desktop without a separate permission request', async () => {
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
            key: 'B' + 'A'.repeat(86),
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
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(registration.pushManager.subscribe).toHaveBeenCalled();
      expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    });
  });

  it('invokes iOS subscribe directly from the Enable gesture with no post-click setup fetch', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    });

    const requestPermission = vi.fn().mockResolvedValue('granted');
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission,
      },
      configurable: true,
    });

    let resolveSubscription!: (value: {
      endpoint: string;
      toJSON: () => { endpoint: string };
    }) => void;
    const subscribe = vi.fn(
      () =>
        new Promise<{
          endpoint: string;
          toJSON: () => { endpoint: string };
        }>(resolve => {
          resolveSubscription = resolve;
        })
    );
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe,
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
          status: 200,
          json: async () => ({ key: 'B' + 'A'.repeat(86) }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => expect(enableButton).not.toBeDisabled());

    const fetchCallsBeforeClick = mockFetch.mock.calls.length;
    fireEvent.click(enableButton);

    // The subscribe call itself must happen synchronously inside the user click.
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBeforeClick);

    resolveSubscription({
      endpoint: 'https://web.push.apple.com/Q123',
      toJSON: () => ({ endpoint: 'https://web.push.apple.com/Q123' }),
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/user/push-subscription',
        expect.objectContaining({ method: 'POST' })
      );
      expect(screen.getByRole('button', { name: /^Disable$/i })).toBeInTheDocument();
    });
  });

  it('uses the direct subscribe gesture flow on macOS Safari', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

    const requestPermission = vi.fn().mockResolvedValue('granted');
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission,
      },
      configurable: true,
    });

    let resolveSubscription!: (value: { endpoint: string }) => void;
    const subscribe = vi.fn(
      () =>
        new Promise<{ endpoint: string }>(resolve => {
          resolveSubscription = resolve;
        })
    );
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe,
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
          status: 200,
          json: async () => ({ key: 'B' + 'A'.repeat(86) }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/user/push-subscription')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => expect(enableButton).not.toBeDisabled());

    const fetchCallsBeforeClick = mockFetch.mock.calls.length;
    fireEvent.click(enableButton);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBeforeClick);

    resolveSubscription({ endpoint: 'https://web.push.apple.com/Q456' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Disable$/i })).toBeInTheDocument();
    });
  });

  it('shows the typed administrator message when VAPID is not configured', async () => {
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
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
          ok: false,
          status: 503,
          json: async () => ({
            error: 'Push notifications are not configured on this server.',
            code: 'PUSH_VAPID_NOT_CONFIGURED',
            action: 'Push is not configured by your administrator.',
            retryable: false,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<PushNotificationToggle />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Push is not configured by your administrator.'
      );
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
  });

  it('ignores a stale reconciliation completion after a newer run wins', async () => {
    const subscription = {
      endpoint: 'https://push.example.com/race-endpoint',
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
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

    let resolveFirst!: (value: unknown) => void;
    const firstStatus = new Promise(resolve => {
      resolveFirst = resolve;
    });
    let statusCalls = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/user/push-subscription/status')) {
        statusCalls += 1;
        if (statusCalls === 1) return firstStatus;
        return {
          ok: true,
          status: 200,
          json: async () => ({ deviceRegistered: false, accountEnabled: true }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<PushNotificationToggle />);

    await waitFor(() => expect(statusCalls).toBe(1));
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(statusCalls).toBe(2);
      expect(screen.getByRole('button', { name: /Repair/i })).toBeInTheDocument();
    });

    resolveFirst({
      ok: true,
      status: 200,
      json: async () => ({ deviceRegistered: true, accountEnabled: true }),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /Repair/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Disable$/i })).not.toBeInTheDocument();
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
    await waitFor(() => expect(button).not.toBeDisabled());
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
    await waitFor(() => expect(button).not.toBeDisabled());
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
    await waitFor(() => expect(button).not.toBeDisabled());
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
    await waitFor(() => expect(button).not.toBeDisabled());
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

  it('handles push subscription timeout and transitions to error state cleanly', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'granted',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockRejectedValue(new Error('Push subscription creation timed out.')),
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
            key: 'B' + 'A'.repeat(86),
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Enable/i })).not.toBeDisabled();
    });
  });

  it('handles permission denied cleanly without hanging in working state', async () => {
    let permission: NotificationPermission = 'default';
    const requestPermission = vi.fn().mockResolvedValue('granted');
    Object.defineProperty(window, 'Notification', {
      value: {
        get permission() {
          return permission;
        },
        requestPermission,
      },
      configurable: true,
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockImplementation(async () => {
          permission = 'denied';
          throw new DOMException('Permission denied', 'NotAllowedError');
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
      if (typeof url === 'string' && url.includes('/api/system/vapid-public-key')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: 'B' + 'A'.repeat(86) }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByText('Blocked')).toBeInTheDocument();
      expect(
        screen.getByText(/Notifications are blocked in browser or device settings/i)
      ).toBeInTheDocument();
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('recovers cleanly when push registration hangs indefinitely', async () => {
    vi.useFakeTimers();
    try {
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
          subscribe: vi.fn().mockImplementation(() => new Promise(() => {})),
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

      mockFetch.mockImplementation(async (url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/system/vapid-public-key')) {
          return {
            ok: true,
            json: async () => ({
              key: 'B' + 'A'.repeat(86),
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      render(<PushNotificationToggle />);

      await act(async () => {
        // Flush preflight promises without waitFor: waitFor itself uses timers and
        // would deadlock while fake timers are active.
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
      });

      const enableButton = screen.getByRole('button', { name: /Enable/i });
      expect(enableButton).not.toBeDisabled();
      fireEvent.click(enableButton);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Enable/i })).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
