// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  verifyClientSession,
  notifySessionExpired,
  onSessionExpired,
  isTerminalSessionError,
  resolveSessionExpiredUrl,
  resetSessionRecoveryState,
} from '@/lib/client-auth-recovery';

describe('client-auth-recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSessionRecoveryState();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    Object.defineProperty(window, 'location', {
      value: { pathname: '/incidents' },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetSessionRecoveryState();
  });

  describe('isTerminalSessionError', () => {
    it('returns true for REVOKED and UNAUTHENTICATED', () => {
      expect(isTerminalSessionError('REVOKED')).toBe(true);
      expect(isTerminalSessionError('UNAUTHENTICATED')).toBe(true);
    });

    it('returns false for VALID and TEMPORARILY_UNAVAILABLE', () => {
      expect(isTerminalSessionError('VALID')).toBe(false);
      expect(isTerminalSessionError('TEMPORARILY_UNAVAILABLE')).toBe(false);
    });
  });

  describe('resolveSessionExpiredUrl', () => {
    it('resolves desktop login URL when on desktop', () => {
      window.location.pathname = '/dashboard';
      expect(resolveSessionExpiredUrl()).toBe('/login?error=SessionExpired');
      expect(resolveSessionExpiredUrl('desktop')).toBe('/login?error=SessionExpired');
    });

    it('resolves mobile login URL when on mobile', () => {
      window.location.pathname = '/m/incidents';
      expect(resolveSessionExpiredUrl()).toBe('/m/login?error=SessionExpired');
      expect(resolveSessionExpiredUrl('mobile')).toBe('/m/login?error=SessionExpired');
    });
  });

  describe('onSessionExpired and notifySessionExpired', () => {
    it('notifies subscribers of session expiration without location.assign', () => {
      window.location.pathname = '/incidents';
      const listener = vi.fn();
      const unsubscribe = onSessionExpired(listener);

      notifySessionExpired();

      expect(listener).toHaveBeenCalledWith('/login?error=SessionExpired', 'desktop');

      unsubscribe();
      notifySessionExpired();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies subscribers with mobile URL when on mobile pathname', () => {
      window.location.pathname = '/m/incidents';
      const listener = vi.fn();
      onSessionExpired(listener);

      notifySessionExpired();

      expect(listener).toHaveBeenCalledWith('/m/login?error=SessionExpired', 'mobile');
    });

    it('skips notifying when already on login page', () => {
      window.location.pathname = '/login';
      const listener = vi.fn();
      onSessionExpired(listener);

      notifySessionExpired();

      expect(listener).not.toHaveBeenCalled();
    });

    it('skips notifying when already on mobile login page', () => {
      window.location.pathname = '/m/login';
      const listener = vi.fn();
      onSessionExpired(listener);

      notifySessionExpired();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('verifyClientSession', () => {
    it('returns TEMPORARILY_UNAVAILABLE when browser is offline without fetching', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await verifyClientSession();

      expect(result).toBe('TEMPORARILY_UNAVAILABLE');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns UNAUTHENTICATED on 401 status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

      const result = await verifyClientSession();

      expect(result).toBe('UNAUTHENTICATED');
    });

    it('returns REVOKED on 403 status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));

      const result = await verifyClientSession();

      expect(result).toBe('REVOKED');
    });

    it('returns TEMPORARILY_UNAVAILABLE on 500 status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));

      const result = await verifyClientSession();

      expect(result).toBe('TEMPORARILY_UNAVAILABLE');
    });

    it('returns TEMPORARILY_UNAVAILABLE on network error (fetch rejects)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await verifyClientSession();

      expect(result).toBe('TEMPORARILY_UNAVAILABLE');
    });

    it('returns VALID when session.user is present', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ user: { id: 'user-1', email: 'test@example.com' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await verifyClientSession();

      expect(result).toBe('VALID');
    });

    it('returns TEMPORARILY_UNAVAILABLE when DB security lookup failed (SECURITY_LOOKUP_UNAVAILABLE)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'SECURITY_LOOKUP_UNAVAILABLE' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await verifyClientSession();

      // Must NOT log the user out!
      expect(result).toBe('TEMPORARILY_UNAVAILABLE');
      expect(isTerminalSessionError(result)).toBe(false);
    });

    it('returns REVOKED when session was revoked by tokenVersion mismatch', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'SESSION_REVOKED' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await verifyClientSession();

      expect(result).toBe('REVOKED');
      expect(isTerminalSessionError(result)).toBe(true);
    });

    it('returns REVOKED when user is disabled', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'USER_DISABLED' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await verifyClientSession();

      expect(result).toBe('REVOKED');
      expect(isTerminalSessionError(result)).toBe(true);
    });

    it('returns UNAUTHENTICATED when session response is empty', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await verifyClientSession();

      expect(result).toBe('UNAUTHENTICATED');
      expect(isTerminalSessionError(result)).toBe(true);
    });

    it('coalesces concurrent verification calls into a single network request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ user: { id: 'u1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const [r1, r2, r3] = await Promise.all([
        verifyClientSession(),
        verifyClientSession(),
        verifyClientSession(),
      ]);

      expect(r1).toBe('VALID');
      expect(r2).toBe('VALID');
      expect(r3).toBe('VALID');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
