// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyServiceWorkerRegistration,
  ensureHealthyServiceWorker,
  ensureWorkerAttached,
  inspectServiceWorkerHealth,
  isOpsKnightServiceWorker,
  preflightServiceWorkerAssets,
  resetServiceWorkerDiagnostics,
  serviceWorkerPath,
} from '@/lib/service-worker-runtime';
import { ClientAppError } from '@/lib/client-error';

const mockFetch = vi.fn();

describe('service-worker-runtime', () => {
  beforeEach(() => {
    resetServiceWorkerDiagnostics();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      const isCustom = urlStr.includes('custom');
      return {
        ok: true,
        status: 200,
        redirected: false,
        url: `${window.location.origin}${isCustom ? '/custom-sw.js' : '/sw.js'}`,
        headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    });
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as Navigator & { standalone?: boolean }).standalone;
    vi.unstubAllGlobals();
  });

  describe('isOpsKnightServiceWorker & classifyServiceWorkerRegistration', () => {
    it('rejects a null or undefined registration', () => {
      expect(isOpsKnightServiceWorker(null)).toBe(false);
      expect(isOpsKnightServiceWorker(undefined)).toBe(false);
      expect(classifyServiceWorkerRegistration(null)).toBe('MISSING');
      expect(classifyServiceWorkerRegistration(undefined)).toBe('MISSING');
    });

    it('identifies root scope with no worker as STALE_REGISTRATION, not healthy', () => {
      const emptyRegistration = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
      } as unknown as ServiceWorkerRegistration;

      expect(isOpsKnightServiceWorker(emptyRegistration)).toBe(false);
      expect(classifyServiceWorkerRegistration(emptyRegistration)).toBe('STALE_REGISTRATION');
    });

    it('identifies unexpected foreign worker under / as WRONG_WORKER', () => {
      const foreignRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/foreign-worker.js`, state: 'activated' },
        waiting: null,
        installing: null,
      } as unknown as ServiceWorkerRegistration;

      expect(isOpsKnightServiceWorker(foreignRegistration)).toBe(false);
      expect(classifyServiceWorkerRegistration(foreignRegistration)).toBe('WRONG_WORKER');
    });

    it('identifies valid /sw.js active worker as HEALTHY_ACTIVE', () => {
      const healthyRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js?v=2`, state: 'activated' },
        waiting: null,
        installing: null,
      } as unknown as ServiceWorkerRegistration;

      expect(isOpsKnightServiceWorker(healthyRegistration)).toBe(true);
      expect(classifyServiceWorkerRegistration(healthyRegistration)).toBe('HEALTHY_ACTIVE');
    });

    it('identifies registration with active old worker and waiting new worker as HEALTHY_ACTIVE', () => {
      const updatingRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js?v=1`, state: 'activated' },
        waiting: { scriptURL: `${window.location.origin}/sw.js?v=2`, state: 'installed' },
        installing: null,
      } as unknown as ServiceWorkerRegistration;

      expect(isOpsKnightServiceWorker(updatingRegistration)).toBe(true);
      expect(classifyServiceWorkerRegistration(updatingRegistration)).toBe('HEALTHY_ACTIVE');
    });

    it('identifies waiting worker without active worker as WAITING', () => {
      const waitingOnlyRegistration = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: { scriptURL: `${window.location.origin}/sw.js`, state: 'installed' },
        installing: null,
      } as unknown as ServiceWorkerRegistration;

      expect(isOpsKnightServiceWorker(waitingOnlyRegistration)).toBe(true);
      expect(classifyServiceWorkerRegistration(waitingOnlyRegistration)).toBe('WAITING');
    });

    it('identifies redundant worker as REDUNDANT', () => {
      const redundantRegistration = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: { scriptURL: `${window.location.origin}/sw.js`, state: 'redundant' },
      } as unknown as ServiceWorkerRegistration;

      expect(classifyServiceWorkerRegistration(redundantRegistration)).toBe('REDUNDANT');
    });

    it('extracts script pathname accurately even with query params', () => {
      const worker = {
        scriptURL: `${window.location.origin}/sw.js?build=12345`,
      } as ServiceWorker;
      expect(serviceWorkerPath(worker)).toBe('/sw.js');
    });
  });

  describe('preflightServiceWorkerAssets', () => {
    it('throws ClientAppError when /sw.js is missing (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        redirected: false,
        url: `${window.location.origin}/sw.js`,
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      await expect(preflightServiceWorkerAssets()).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action: 'Service worker file is missing from this deployment.',
        })
      );
    });

    it('throws ClientAppError when /sw.js returns HTML', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        redirected: false,
        url: `${window.location.origin}/sw.js`,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      });

      await expect(preflightServiceWorkerAssets()).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action:
            'Service worker returned HTML instead of JavaScript. Check reverse proxy or host routing.',
        })
      );
    });

    it('throws ClientAppError when /sw.js is redirected', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        redirected: true,
        url: 'https://login.example.com/sw.js',
        headers: new Headers({ 'content-type': 'application/javascript' }),
      });

      await expect(preflightServiceWorkerAssets()).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action:
            'Service worker redirected to another origin. Check reverse proxy or host routing.',
        })
      );
    });

    it('throws ClientAppError when /custom-sw.js is unavailable', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url === '/sw.js') {
          return {
            ok: true,
            status: 200,
            redirected: false,
            url: `${window.location.origin}/sw.js`,
            headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
          };
        }
        return {
          ok: false,
          status: 404,
          redirected: false,
          url: `${window.location.origin}/custom-sw.js`,
          headers: new Headers({ 'content-type': 'text/html' }),
        };
      });

      await expect(preflightServiceWorkerAssets()).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action: 'Service worker dependency is missing from this deployment.',
        })
      );
    });

    it('succeeds when both /sw.js and /custom-sw.js return valid JS', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const isCustom = typeof url === 'string' && url.includes('custom');
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: `${window.location.origin}${isCustom ? '/custom-sw.js' : '/sw.js'}`,
          headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
        };
      });

      const result = await preflightServiceWorkerAssets();
      expect(result.swAssetStatus).toContain('200');
      expect(result.customSwAssetStatus).toContain('200');
    });

    it('throws ClientAppError when /custom-sw.js rewrites to /sw.js', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr === '/sw.js') {
          return {
            ok: true,
            status: 200,
            redirected: false,
            url: `${window.location.origin}/sw.js`,
            headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
          };
        }
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: `${window.location.origin}/sw.js`, // Invalid rewrite to /sw.js!
          headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
        };
      });

      await expect(preflightServiceWorkerAssets()).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action:
            'Service worker dependency resolved to the wrong URL. Check reverse proxy or host routing.',
        })
      );
    });

    it('throws ClientAppError when /custom-sw.js is cross-origin', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr === '/sw.js') {
          return {
            ok: true,
            status: 200,
            redirected: false,
            url: `${window.location.origin}/sw.js`,
            headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
          };
        }
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: 'https://evil.attacker.com/custom-sw.js',
          headers: new Headers({ 'content-type': 'application/javascript; charset=utf-8' }),
        };
      });

      await expect(preflightServiceWorkerAssets()).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action:
            'Service worker dependency resolved to the wrong URL. Check reverse proxy or host routing.',
        })
      );
    });
  });

  describe('ensureHealthyServiceWorker lifecycle state machine', () => {
    it('returns existing healthy active registration on iOS without awaiting navigator.serviceWorker.ready', async () => {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
      );
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');

      const registration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: null,
        installing: null,
        pushManager: {},
      } as unknown as ServiceWorkerRegistration;

      const neverResolvingReady = new Promise<ServiceWorkerRegistration>(() => {});

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          ready: neverResolvingReady,
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({ purpose: 'push-enrollment' });
      expect(ready).toBe(registration);
    });

    it('preserves active client when active + waiting worker exist and policy is preserve-active-client', async () => {
      const waitingPostMessage = vi.fn();
      const waitingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installed',
        postMessage: waitingPostMessage,
      };

      const registration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: waitingWorker,
        installing: null,
        pushManager: {},
      } as unknown as ServiceWorkerRegistration;

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          ready: Promise.resolve(registration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'inspection',
        activationPolicy: 'preserve-active-client',
      });

      expect(ready).toBe(registration);
      expect(waitingPostMessage).not.toHaveBeenCalled();
    });

    it('does not send SKIP_WAITING when active worker exists even under recover-if-no-active', async () => {
      const waitingPostMessage = vi.fn();
      const registration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: {
          scriptURL: `${window.location.origin}/sw.js`,
          state: 'installed',
          postMessage: waitingPostMessage,
        },
        installing: null,
        pushManager: {},
      } as unknown as ServiceWorkerRegistration;

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          ready: Promise.resolve(registration),
        },
        configurable: true,
      });

      await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
      });

      expect(waitingPostMessage).not.toHaveBeenCalled();
    });

    it('activates waiting worker when no active worker exists under recover-if-no-active', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const waitingPostMessage = vi.fn(() => {
        // Worker activates in response to SKIP_WAITING
        setTimeout(() => {
          registration.active = {
            scriptURL: `${window.location.origin}/sw.js`,
            state: 'activated',
          };
          if (stateChangeHandler) stateChangeHandler();
        }, 10);
      });

      const waitingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installed',
        postMessage: waitingPostMessage,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const registration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: waitingWorker,
        installing: null,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
      });

      expect(waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(ready.active).toBeTruthy();
    });

    it('handles installing -> activated transition cleanly on fresh register', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const installingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installing',
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const registration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: installingWorker,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      setTimeout(() => {
        installingWorker.state = 'activated';
        registration.active = {
          scriptURL: `${window.location.origin}/sw.js`,
          state: 'activated',
        };
        if (stateChangeHandler) stateChangeHandler();
      }, 15);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(null),
          register: vi.fn().mockResolvedValue(registration),
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
      });

      expect(ready.active).toBeTruthy();
    });

    it('triggers SKIP_WAITING through installing -> installed -> waiting -> activated', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const workerPostMessage = vi.fn(() => {
        setTimeout(() => {
          worker.state = 'activated';
          registration.active = worker;
          if (stateChangeHandler) stateChangeHandler();
        }, 10);
      });

      const worker: Record<string, unknown> = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installing',
        postMessage: workerPostMessage,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const registration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: worker,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      // Step 1: installing -> installed (waiting)
      setTimeout(() => {
        worker.state = 'installed';
        registration.installing = null;
        registration.waiting = worker;
        if (stateChangeHandler) stateChangeHandler();
      }, 10);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(null),
          register: vi.fn().mockResolvedValue(registration),
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
      });

      expect(workerPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(ready.active).toBeTruthy();
    });

    it('fails immediately when installing worker becomes redundant instead of hanging', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const worker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installing',
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const registration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: worker,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        unregister: vi.fn().mockResolvedValue(true),
      };

      setTimeout(() => {
        worker.state = 'redundant';
        if (stateChangeHandler) stateChangeHandler();
      }, 10);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(null),
          register: vi.fn().mockResolvedValue(registration),
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      await expect(
        ensureHealthyServiceWorker({
          purpose: 'push-enrollment',
          activationPolicy: 'recover-if-no-active',
          timeoutMs: 3_000,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'PUSH_SW_REGISTRATION_FAILED',
          action: 'Service worker installation failed before activation. Retry.',
        })
      );
    });

    it('automatically repairs stale registration that recovers via update()', async () => {
      const staleRegistration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        update: vi.fn(async () => {
          staleRegistration.active = {
            scriptURL: `${window.location.origin}/sw.js`,
            state: 'activated',
          };
        }),
        unregister: vi.fn().mockResolvedValue(true),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(staleRegistration),
          register: vi.fn(),
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
      });

      expect(staleRegistration.update).toHaveBeenCalledTimes(1);
      expect(ready.active).toBeTruthy();
    });

    it('repairs stale registration when update() transitions to INSTALLING worker without unregistering', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const unregisterMock = vi.fn().mockResolvedValue(true);
      const installingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installing',
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const staleRegistration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        unregister: unregisterMock,
        update: vi.fn(async () => {
          staleRegistration.installing = installingWorker;
          setTimeout(() => {
            installingWorker.state = 'activated';
            staleRegistration.active = {
              scriptURL: `${window.location.origin}/sw.js`,
              state: 'activated',
            };
            if (stateChangeHandler) stateChangeHandler();
          }, 15);
        }),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(staleRegistration),
          register: vi.fn(),
          ready: Promise.resolve(staleRegistration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'inspection',
        activationPolicy: 'preserve-active-client',
      });

      expect(staleRegistration.update).toHaveBeenCalledTimes(1);
      // Crucial: unregister must NOT be called when update() results in an installing worker!
      expect(unregisterMock).not.toHaveBeenCalled();
      expect(ready.active).toBeTruthy();
    });

    it('repairs stale registration when update() transitions to WAITING worker under preserve-active-client', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const unregisterMock = vi.fn().mockResolvedValue(true);
      const waitingPostMessage = vi.fn(() => {
        setTimeout(() => {
          staleRegistration.active = {
            scriptURL: `${window.location.origin}/sw.js`,
            state: 'activated',
          };
          if (stateChangeHandler) stateChangeHandler();
        }, 10);
      });

      const waitingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installed',
        postMessage: waitingPostMessage,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const staleRegistration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        unregister: unregisterMock,
        update: vi.fn(async () => {
          staleRegistration.waiting = waitingWorker;
        }),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(staleRegistration),
          register: vi.fn(),
          ready: Promise.resolve(staleRegistration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'inspection',
        activationPolicy: 'preserve-active-client',
      });

      expect(staleRegistration.update).toHaveBeenCalledTimes(1);
      expect(waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      // Crucial: unregister must NOT be called when update() finds a waiting worker!
      expect(unregisterMock).not.toHaveBeenCalled();
      expect(ready.active).toBeTruthy();
    });

    it('automatically unregisters wrong worker under / and cleanly re-registers /sw.js', async () => {
      const unregisterMock = vi.fn().mockResolvedValue(true);
      const foreignRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/legacy-app-worker.js`, state: 'activated' },
        waiting: null,
        installing: null,
        unregister: unregisterMock,
        update: vi.fn().mockResolvedValue(undefined),
      };

      const cleanRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: null,
        installing: null,
      };

      const registerMock = vi.fn().mockResolvedValue(cleanRegistration);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(foreignRegistration),
          register: registerMock,
          ready: Promise.resolve(cleanRegistration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
      });

      expect(unregisterMock).toHaveBeenCalledTimes(1);
      expect(registerMock).toHaveBeenCalledWith('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      expect(ready.active?.scriptURL).toContain('/sw.js');
    });

    it('performs at most one repair attempt without infinite loops', async () => {
      const registerMock = vi.fn().mockRejectedValue(new Error('Browser registration rejected'));

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(null),
          register: registerMock,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      await expect(
        ensureHealthyServiceWorker({
          purpose: 'push-enrollment',
          activationPolicy: 'recover-if-no-active',
        })
      ).rejects.toThrow(ClientAppError);

      // Normal attempt: 1, Repair attempt: 1 -> total max 2 register calls, never an infinite loop
      expect(registerMock).toHaveBeenCalledTimes(2);
    });

    it('awaits installation completion under preserve-active-client without unregistering', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const unregisterMock = vi.fn().mockResolvedValue(true);
      const installingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installing',
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const registration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: installingWorker,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        unregister: unregisterMock,
        update: vi.fn(),
      };

      setTimeout(() => {
        installingWorker.state = 'activated';
        registration.active = {
          scriptURL: `${window.location.origin}/sw.js`,
          state: 'activated',
        };
        if (stateChangeHandler) stateChangeHandler();
      }, 15);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          ready: Promise.resolve(registration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'inspection',
        activationPolicy: 'preserve-active-client',
      });

      // Crucial: unregister must NEVER be called on a healthy fresh installing worker!
      expect(unregisterMock).not.toHaveBeenCalled();
      expect(ready.active).toBeTruthy();
    });

    it('activates waiting worker when no active worker exists under preserve-active-client', async () => {
      let stateChangeHandler: (() => void) | null = null;
      const unregisterMock = vi.fn().mockResolvedValue(true);
      const waitingPostMessage = vi.fn(() => {
        setTimeout(() => {
          registration.active = {
            scriptURL: `${window.location.origin}/sw.js`,
            state: 'activated',
          };
          if (stateChangeHandler) stateChangeHandler();
        }, 10);
      });

      const waitingWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installed',
        postMessage: waitingPostMessage,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'statechange') stateChangeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const registration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: waitingWorker,
        installing: null,
        pushManager: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        unregister: unregisterMock,
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          ready: Promise.resolve(registration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'inspection',
        activationPolicy: 'preserve-active-client',
      });

      // Crucial: must activate waiting worker because no active client exists, and never unregister
      expect(waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(unregisterMock).not.toHaveBeenCalled();
      expect(ready.active).toBeTruthy();
    });

    it('serializes concurrent ensureHealthyServiceWorker calls via lifecycle mutex without redundant registrations', async () => {
      let registerCallCount = 0;
      const cleanRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: null,
        installing: null,
      };

      const registerMock = vi.fn().mockImplementation(async () => {
        registerCallCount++;
        // Simulate slight async delay
        await new Promise(r => setTimeout(r, 20));
        return cleanRegistration;
      });

      let currentRegistration: typeof cleanRegistration | null = null;

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockImplementation(async () => currentRegistration),
          register: vi.fn().mockImplementation(async (...args) => {
            const reg = await registerMock(...args);
            currentRegistration = reg;
            return reg;
          }),
          ready: Promise.resolve(cleanRegistration),
        },
        configurable: true,
      });

      // Push + coordinator + background-sync invoking lifecycle concurrently
      const [res1, res2, res3] = await Promise.all([
        ensureHealthyServiceWorker({
          purpose: 'push-enrollment',
          activationPolicy: 'recover-if-no-active',
        }),
        ensureHealthyServiceWorker({
          purpose: 'inspection',
          activationPolicy: 'preserve-active-client',
        }),
        ensureHealthyServiceWorker({
          purpose: 'background-sync',
          activationPolicy: 'preserve-active-client',
        }),
      ]);

      expect(res1).toBe(cleanRegistration);
      expect(res2).toBe(cleanRegistration);
      expect(res3).toBe(cleanRegistration);
      // Thanks to the lifecycle mutex, register is called only once for initial registration
      expect(registerCallCount).toBe(1);
    });

    it('resets diagnostics at the start of each lifecycle operation', async () => {
      // Run 1: force repair failure
      const registerMock = vi.fn().mockRejectedValue(new Error('Browser registration rejected'));
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(null),
          register: registerMock,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      await expect(ensureHealthyServiceWorker({ purpose: 'push-enrollment' })).rejects.toThrow();

      let health = await inspectServiceWorkerHealth();
      expect(health.repairAttempted).toBe(true);
      expect(health.lastFailureCode).toBeTruthy();

      // Run 2: healthy registration
      const healthyReg = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: null,
        installing: null,
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(healthyReg),
          ready: Promise.resolve(healthyReg),
        },
        configurable: true,
      });

      await ensureHealthyServiceWorker({ purpose: 'inspection' });

      health = await inspectServiceWorkerHealth();
      // Diagnostics must be fresh and not report stale repair attempt from previous run
      expect(health.repairAttempted).toBe(false);
      expect(health.repairResult).toBeNull();
      expect(health.lastFailureCode).toBeNull();
    });

    it('skips update() and goes straight to unregister when worker is stuck in installing', async () => {
      const updateMock = vi.fn().mockResolvedValue(undefined);
      const unregisterMock = vi.fn().mockResolvedValue(true);
      const cleanRegistration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: null,
        installing: null,
      };

      const stuckWorker = {
        scriptURL: `${window.location.origin}/sw.js`,
        state: 'installing',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      const stuckRegistration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: stuckWorker,
        update: updateMock,
        unregister: unregisterMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      const registerMock = vi.fn().mockResolvedValue(cleanRegistration);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(stuckRegistration),
          register: registerMock,
          ready: Promise.resolve(cleanRegistration),
        },
        configurable: true,
      });

      const ready = await ensureHealthyServiceWorker({
        purpose: 'push-enrollment',
        activationPolicy: 'recover-if-no-active',
        timeoutMs: 50,
      });

      // Crucial: update() must NOT be called on a stuck installing worker
      expect(updateMock).not.toHaveBeenCalled();
      // Crucial: unregister() must be called to purge the stuck install job
      expect(unregisterMock).toHaveBeenCalledTimes(1);
      // Fresh registration must proceed
      expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
      expect(ready).toBe(cleanRegistration);
    });

    it('halts recovery and never attempts register when unregister times out', async () => {
      const unregisterMock = vi.fn().mockReturnValue(new Promise(() => {}));
      const registerMock = vi.fn();

      const staleRegistration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        update: vi.fn().mockRejectedValue(new Error('Update failed')),
        unregister: unregisterMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(staleRegistration),
          register: registerMock,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      await expect(
        ensureHealthyServiceWorker({
          purpose: 'push-enrollment',
          activationPolicy: 'recover-if-no-active',
          timeoutMs: 50,
        })
      ).rejects.toThrow(ClientAppError);

      expect(unregisterMock).toHaveBeenCalledTimes(1);
      // Crucial: register must NEVER be called after unregister timeout!
      expect(registerMock).not.toHaveBeenCalled();

      const health = await inspectServiceWorkerHealth();
      expect(health.lastFailureCode).toBe('SW_UNREGISTER_TIMEOUT');
    });

    it('halts recovery and never attempts duplicate register when fresh registration times out', async () => {
      let registerCallCount = 0;
      const registerMock = vi.fn().mockImplementation(() => {
        registerCallCount++;
        return new Promise(() => {});
      });

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(null),
          register: registerMock,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      await expect(
        ensureHealthyServiceWorker({
          purpose: 'push-enrollment',
          activationPolicy: 'recover-if-no-active',
          timeoutMs: 50,
        })
      ).rejects.toThrow(ClientAppError);

      // Called only once in Step 3, never re-attempted in repair after timeout
      expect(registerCallCount).toBe(1);

      const health = await inspectServiceWorkerHealth();
      expect(health.lastFailureCode).toBe('SW_REGISTRATION_TIMEOUT');
    });

    it('halts recovery and never attempts unregister or register when update times out', async () => {
      const updateMock = vi.fn().mockReturnValue(new Promise(() => {}));
      const unregisterMock = vi.fn();
      const registerMock = vi.fn();

      const suspectRegistration: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        update: updateMock,
        unregister: unregisterMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(suspectRegistration),
          register: registerMock,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });

      await expect(
        ensureHealthyServiceWorker({
          purpose: 'push-enrollment',
          activationPolicy: 'recover-if-no-active',
          timeoutMs: 50,
        })
      ).rejects.toThrow(ClientAppError);

      expect(updateMock).toHaveBeenCalledTimes(1);
      // Crucial: unregister and register must NEVER be called after update timeout!
      expect(unregisterMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();

      const health = await inspectServiceWorkerHealth();
      expect(health.lastFailureCode).toBe('SW_UPDATE_TIMEOUT');
    });
  });

  describe('ensureWorkerAttached', () => {
    it('returns immediately if active worker is already present', async () => {
      const reg = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js`, state: 'activated' },
        waiting: null,
        installing: null,
      } as unknown as ServiceWorkerRegistration;

      const result = await ensureWorkerAttached(reg, 100);
      expect(result).toBe(reg);
    });

    it('returns immediately if installing worker is already present', async () => {
      const reg = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: { scriptURL: `${window.location.origin}/sw.js`, state: 'installing' },
      } as unknown as ServiceWorkerRegistration;

      const result = await ensureWorkerAttached(reg, 100);
      expect(result).toBe(reg);
    });

    it('resolves as soon as updatefound fires and worker becomes attached', async () => {
      let updatefoundHandler: (() => void) | null = null;
      const reg: Record<string, unknown> = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'updatefound') updatefoundHandler = handler;
        }),
        removeEventListener: vi.fn(),
      };

      const promise = ensureWorkerAttached(reg as unknown as ServiceWorkerRegistration, 500);

      // Simulate browser attaching worker and firing updatefound
      reg.installing = { scriptURL: `${window.location.origin}/sw.js`, state: 'installing' };
      if (typeof updatefoundHandler === 'function') {
        (updatefoundHandler as () => void)();
      }

      const result = await promise;
      expect(result).toBe(reg);
      expect(reg.removeEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
    });

    it('falls back gracefully after timeout if no worker ever attaches', async () => {
      const reg = {
        scope: `${window.location.origin}/`,
        active: null,
        waiting: null,
        installing: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as ServiceWorkerRegistration;

      const result = await ensureWorkerAttached(reg, 20);
      expect(result).toBe(reg);
    });
  });

  describe('inspectServiceWorkerHealth diagnostic snapshot', () => {
    it('produces complete diagnostics without exposing secrets', async () => {
      const registration = {
        scope: `${window.location.origin}/`,
        active: { scriptURL: `${window.location.origin}/sw.js?v=2`, state: 'activated' },
        waiting: null,
        installing: null,
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: vi.fn().mockResolvedValue(registration),
          controller: registration.active,
        },
        configurable: true,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        redirected: false,
        url: `${window.location.origin}/sw.js`,
        headers: new Headers({ 'content-type': 'application/javascript' }),
      });

      const health = await inspectServiceWorkerHealth();

      expect(health.classification).toBe('HEALTHY_ACTIVE');
      expect(health.registrationFound).toBe(true);
      expect(health.controllerActive).toBe(true);
      expect(health.scope).toBe(`${window.location.origin}/`);
      expect(health.activeWorker?.scriptURL).toContain('/sw.js');

      // Crucial: verify no sensitive tokens or secrets are exposed in the snapshot
      const serialized = JSON.stringify(health);
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('token');
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('authGeneration');
    });
  });
});
