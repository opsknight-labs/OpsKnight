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
      active: { scriptURL: 'https://opsknight.example/sw.js' },
      waiting: null,
      installing: null,
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

  it('reports a missing /sw.js file before attempting registration', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register,
        ready: new Promise(() => {}),
      },
      configurable: true,
    });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      redirected: false,
      url: `${window.location.origin}/sw.js`,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });

    render(<PushNotificationToggle />);
    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Service worker file is missing from this deployment.'
      );
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('reports HTML returned from /sw.js before attempting registration', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register,
        ready: new Promise(() => {}),
      },
      configurable: true,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: false,
      url: `${window.location.origin}/sw.js`,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    });

    render(<PushNotificationToggle />);
    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Service worker returned HTML instead of JavaScript. Check reverse proxy or host routing.'
      );
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('reports a redirected /sw.js response before attempting registration', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register,
        ready: new Promise(() => {}),
      },
      configurable: true,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: 'https://login.example.com/sw.js',
      headers: new Headers({ 'content-type': 'application/javascript' }),
    });

    render(<PushNotificationToggle />);
    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Service worker redirected to another origin. Check reverse proxy or host routing.'
      );
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('registers /sw.js after a valid JavaScript preflight', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const registration = {
      active: { scriptURL: 'https://opsknight.example/sw.js' },
      waiting: null,
      installing: null,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: 'https://push.example.com/preflight',
        }),
      },
    };
    const register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register,
        ready: Promise.resolve(registration),
      },
      configurable: true,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: false,
      url: `${window.location.origin}/sw.js`,
      headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/sw.js',
        expect.objectContaining({
          cache: 'no-store',
          redirect: 'follow',
        })
      );
      expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });
  });

  it('shows a stage-aware message when the service worker never becomes ready', async () => {
    vi.useFakeTimers();
    try {
      const registration = {
        active: { scriptURL: 'https://opsknight.example/sw.js' },
        waiting: null,
        installing: null,
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(null),
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          register: vi.fn().mockResolvedValue(registration),
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      render(<PushNotificationToggle />);

      await act(async () => {
        // Let preflight reach the ready wait, then exhaust the 25s budget.
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(25_000);
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
      });

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Service worker did not become ready. Retry.'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows iOS-style service worker readiness to take longer than the old 8 second budget', async () => {
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
        active: { scriptURL: 'https://opsknight.example/sw.js?build=previous' },
        waiting: null,
        installing: null,
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(null),
          subscribe: vi.fn(),
        },
      };
      let resolveReady!: (value: typeof registration) => void;
      const ready = new Promise<typeof registration>(resolve => {
        resolveReady = resolve;
      });
      const register = vi.fn().mockResolvedValue(registration);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          register,
          ready,
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

      await act(async () => {
        // Let preflight reach navigator.serviceWorker.ready so the readiness
        // timeout is definitely armed before advancing past the old 8s budget.
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(12_000);
        resolveReady(registration);
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });

      const enableButton = screen.getByRole('button', { name: /Enable/i });
      expect(enableButton).not.toBeDisabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(register).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses an existing /sw.js registration with a waiting update and returns the ready registration', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const existingGetSubscription = vi
      .fn()
      .mockRejectedValue(
        new Error('The pre-ready registration should not be used for Push lookup.')
      );
    const existingRegistration = {
      active: { scriptURL: 'https://opsknight.example/sw.js?build=old' },
      waiting: { scriptURL: 'https://opsknight.example/sw.js?build=new' },
      installing: null,
      pushManager: {
        getSubscription: existingGetSubscription,
      },
    };
    const readyGetSubscription = vi.fn().mockResolvedValue(null);
    const readyRegistration = {
      active: { scriptURL: 'https://opsknight.example/sw.js?build=old' },
      waiting: { scriptURL: 'https://opsknight.example/sw.js?build=new' },
      installing: null,
      pushManager: {
        getSubscription: readyGetSubscription,
        subscribe: vi.fn(),
      },
    };
    const register = vi.fn().mockResolvedValue(existingRegistration);

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(existingRegistration),
        register,
        ready: Promise.resolve(readyRegistration),
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

    expect(register).not.toHaveBeenCalled();
    expect(existingGetSubscription).not.toHaveBeenCalled();
    expect(readyGetSubscription).not.toHaveBeenCalled();

    fireEvent.click(enableButton);

    await waitFor(() => expect(readyGetSubscription).toHaveBeenCalledTimes(1));
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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

  it('requests notification permission from the Enable gesture before desktop subscription', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });
    const registration = {
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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

    expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(registration.pushManager.subscribe).toHaveBeenCalled();
    });
  });

  it('does not prompt again when notification permission is already granted', async () => {
    const requestPermission = vi.fn();
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'granted',
        requestPermission,
      },
      configurable: true,
    });

    const subscribe = vi.fn().mockResolvedValue({ endpoint: 'https://push.example.com/granted' });
    const registration = {
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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
      if (url.includes('/api/system/vapid-public-key')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: 'B' + 'A'.repeat(86) }),
        };
      }
      if (url.includes('/api/user/push-subscription')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    fireEvent.click(enableButton);

    // With an existing grant there is no permission await: subscription starts
    // directly in the same gesture task.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('requests native iOS permission from Enable before starting setup', async () => {
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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

    // The native permission request must be invoked synchronously from the
    // user gesture. SW/VAPID setup starts only after permission resolves.
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBeforeClick);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

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

  it('allows an iOS permission decision to take longer than network timeouts', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
      );
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      });

      let resolvePermission!: (value: NotificationPermission) => void;
      const requestPermission = vi.fn(
        () =>
          new Promise<NotificationPermission>(resolve => {
            resolvePermission = resolve;
          })
      );
      Object.defineProperty(window, 'Notification', {
        value: {
          permission: 'default',
          requestPermission,
        },
        configurable: true,
      });

      const subscribe = vi.fn().mockResolvedValue({
        endpoint: 'https://web.push.apple.com/slow-permission',
      });
      const registration = {
        active: { scriptURL: `${window.location.origin}/sw.js` },
        waiting: null,
        installing: null,
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
        if (url.includes('/api/system/vapid-public-key')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ key: 'B' + 'A'.repeat(86) }),
          };
        }
        if (url.includes('/api/user/push-subscription')) {
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        return { ok: false, status: 404 };
      });

      render(<PushNotificationToggle />);

      await act(async () => {
        // Flush mount effects without waitFor: waitFor itself uses timers and
        // can deadlock while fake timers are active.
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
      });

      const enableButton = screen.getByRole('button', { name: /Enable/i });
      expect(enableButton).not.toBeDisabled();
      fireEvent.click(enableButton);

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(subscribe).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(subscribe).not.toHaveBeenCalled();

      await act(async () => {
        resolvePermission('granted');
        await Promise.resolve();
      });

      expect(subscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('requests Safari notification permission before macOS Push subscription', async () => {
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBeforeClick);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

    resolveSubscription({ endpoint: 'https://web.push.apple.com/Q456' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Disable$/i })).toBeInTheDocument();
    });
  });

  it('shows the typed administrator message when VAPID is not configured', async () => {
    const registration = {
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
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
    const requestPermission = vi.fn().mockImplementation(async () => {
      permission = 'denied';
      return 'denied' as NotificationPermission;
    });
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
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn(),
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
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
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
        active: { scriptURL: `${window.location.origin}/sw.js` },
        waiting: null,
        installing: null,
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
        // Flush mount effects without waitFor: waitFor itself uses timers and
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

  it('bypasses unresolved navigator.serviceWorker.ready on iOS when active registration is present', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    });

    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const registration = {
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: null,
      installing: null,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    };

    // WebKit bug: navigator.serviceWorker.ready never resolves for uncontrolled clients
    const neverResolvingReady = new Promise<ServiceWorkerRegistration>(() => {});

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: neverResolvingReady,
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
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enable/i })).not.toBeDisabled();
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('bypasses unresolved navigator.serviceWorker.ready on iOS even when a waiting worker is present', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    });

    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const registration = {
      active: { scriptURL: `${window.location.origin}/sw.js` },
      waiting: { scriptURL: `${window.location.origin}/sw.js` },
      installing: null,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    };

    // WebKit bug: navigator.serviceWorker.ready never resolves for uncontrolled clients
    const neverResolvingReady = new Promise<ServiceWorkerRegistration>(() => {});

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: neverResolvingReady,
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
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enable/i })).not.toBeDisabled();
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('handles fresh PWA installation on iOS when service worker is initially installing and ready never settles', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    });

    const requestPermissionMock = vi.fn().mockResolvedValue('granted');
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: requestPermissionMock,
      },
      configurable: true,
    });

    let stateChangeHandler: (() => void) | null = null;
    const installingWorker = {
      scriptURL: `${window.location.origin}/sw.js`,
      state: 'installing',
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'statechange') {
          stateChangeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };

    const subscribeMock = vi.fn().mockResolvedValue({
      endpoint: 'https://push.apple.com/sub/ios-fresh-test',
      toJSON: () => ({ endpoint: 'https://push.apple.com/sub/ios-fresh-test' }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    });

    const registration: Record<string, unknown> = {
      active: null,
      waiting: null,
      installing: installingWorker,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: subscribeMock,
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    // Simulate worker activating shortly after registration
    setTimeout(() => {
      installingWorker.state = 'activated';
      registration.active = { scriptURL: `${window.location.origin}/sw.js` };
      if (stateChangeHandler) {
        stateChangeHandler();
      }
    }, 20);

    const neverResolvingReady = new Promise<ServiceWorkerRegistration>(() => {});

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        // Fresh install: no initial registration
        getRegistration: vi.fn().mockResolvedValue(null),
        register: vi.fn().mockResolvedValue(registration),
        ready: neverResolvingReady,
      },
      configurable: true,
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/sw.js')) {
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: `${window.location.origin}/sw.js`,
          headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
        };
      }
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

    // The initial state must display Enable promptly without waiting for setup.
    const enableButton = await screen.findByRole('button', { name: /Enable/i });
    await waitFor(() => {
      expect(enableButton).not.toBeDisabled();
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Tapping Enable must trigger the native iOS permission prompt from user gesture
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('On')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Disable/i })).toBeInTheDocument();
    });
  });

  it('rejects on iOS when installing worker fails and becomes redundant without activating', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    });

    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    let stateChangeHandler: (() => void) | null = null;
    const installingWorker = {
      scriptURL: `${window.location.origin}/sw.js`,
      state: 'installing',
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'statechange') {
          stateChangeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };

    const registration: Record<string, unknown> = {
      active: null,
      waiting: null,
      installing: installingWorker,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    // Worker fails installation and transitions to redundant
    setTimeout(() => {
      installingWorker.state = 'redundant';
      if (stateChangeHandler) {
        stateChangeHandler();
      }
    }, 20);

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register: vi.fn().mockResolvedValue(registration),
        ready: new Promise(() => {}),
      },
      configurable: true,
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/sw.js')) {
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: `${window.location.origin}/sw.js`,
          headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
        };
      }
      return { ok: false, status: 404 };
    });

    render(<PushNotificationToggle />);
    fireEvent.click(await screen.findByRole('button', { name: /Enable/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Service worker did not become ready. Retry.'
      );
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('sends SKIP_WAITING to waiting worker on iOS and completes activation', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    );
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      configurable: true,
    });

    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      configurable: true,
    });

    const waitingWorkerPostMessage = vi.fn();
    const waitingWorker = {
      scriptURL: `${window.location.origin}/sw.js`,
      state: 'installed',
      postMessage: waitingWorkerPostMessage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const subscribeMock = vi.fn().mockResolvedValue({
      endpoint: 'https://push.apple.com/sub/ios-skip-waiting-test',
      toJSON: () => ({ endpoint: 'https://push.apple.com/sub/ios-skip-waiting-test' }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    });

    const registration: Record<string, unknown> = {
      scope: `${window.location.origin}/`,
      active: null,
      waiting: waitingWorker,
      installing: null,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: subscribeMock,
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    // When SKIP_WAITING is received, transition to active
    waitingWorkerPostMessage.mockImplementation((message: { type: string }) => {
      if (message?.type === 'SKIP_WAITING') {
        setTimeout(() => {
          registration.active = { scriptURL: `${window.location.origin}/sw.js` };
        }, 10);
      }
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        register: vi.fn().mockResolvedValue(registration),
        ready: new Promise(() => {}),
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
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(waitingWorkerPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Disable/i })).toBeInTheDocument();
    });
  });
});
