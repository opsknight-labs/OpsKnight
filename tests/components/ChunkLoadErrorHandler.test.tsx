import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ChunkLoadErrorHandler, {
  MAX_AUTO_RELOADS,
  CHUNK_RECOVERY_STORAGE_KEY,
} from '@/components/ChunkLoadErrorHandler';

describe('ChunkLoadErrorHandler', () => {
  const originalLocation = window.location;
  const reloadMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reloadMock.mockClear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: reloadMock,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('should reload on first ChunkLoadError when budget is available', () => {
    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'Loading chunk 842 failed. (missing: /_next/static/chunks/842.js)',
    });
    act(() => {
      window.dispatchEvent(errorEvent);
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY) || '{}');
    expect(stored.count).toBe(1);
  });

  it('should reload on second chunk error when within MAX_AUTO_RELOADS budget', () => {
    sessionStorage.setItem(
      CHUNK_RECOVERY_STORAGE_KEY,
      JSON.stringify({ count: 1, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() })
    );

    render(<ChunkLoadErrorHandler />);

    const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new Error(
        'Failed to fetch dynamically imported module: /_next/static/chunks/pages/users.js'
      ),
    });
    act(() => {
      window.dispatchEvent(rejectionEvent);
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY) || '{}');
    expect(stored.count).toBe(2);
  });

  it('should stop automatically reloading and show recovery UI when budget is exhausted', async () => {
    sessionStorage.setItem(
      CHUNK_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        count: MAX_AUTO_RELOADS,
        firstAttemptAt: Date.now(),
        lastAttemptAt: Date.now(),
      })
    );

    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'ChunkLoadError: Loading chunk 123 failed',
    });
    act(() => {
      window.dispatchEvent(errorEvent);
    });

    // MUST NOT reload automatically
    expect(reloadMock).not.toHaveBeenCalled();

    // MUST display user-facing recovery prompt
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Application Update Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });

  it('should not reload and show recovery UI if sessionStorage throws (fail-safe)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: Access denied');
    });

    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'ChunkLoadError: Loading chunk 456 failed',
    });
    act(() => {
      window.dispatchEvent(errorEvent);
    });

    // Fail-safe: Storage error must never result in infinite auto-reloads
    expect(reloadMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('clicking manual reload clears recovery budget and triggers window.location.reload()', async () => {
    sessionStorage.setItem(
      CHUNK_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        count: MAX_AUTO_RELOADS,
        firstAttemptAt: Date.now(),
        lastAttemptAt: Date.now(),
      })
    );

    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'ChunkLoadError: Loading chunk 123 failed',
    });
    act(() => {
      window.dispatchEvent(errorEvent);
    });

    const reloadButton = await screen.findByRole('button', { name: /reload page/i });
    act(() => {
      fireEvent.click(reloadButton);
    });

    expect(sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY)).toBeNull();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('should ignore unrelated runtime errors', () => {
    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'TypeError: Cannot read property of undefined',
    });
    window.dispatchEvent(errorEvent);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should suppress reload when navigator.webdriver is true', () => {
    Object.defineProperty(navigator, 'webdriver', {
      configurable: true,
      value: true,
    });

    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'ChunkLoadError: Loading chunk 999 failed',
    });
    window.dispatchEvent(errorEvent);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    Object.defineProperty(navigator, 'webdriver', {
      configurable: true,
      value: false,
    });
  });
});
