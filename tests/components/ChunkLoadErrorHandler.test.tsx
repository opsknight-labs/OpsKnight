import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import ChunkLoadErrorHandler from '@/components/ChunkLoadErrorHandler';

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
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('should reload when ChunkLoadError occurs', () => {
    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'Loading chunk 842 failed. (missing: /_next/static/chunks/842.js)',
    });
    window.dispatchEvent(errorEvent);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('opsknight_chunk_reload_timestamp')).toBeTruthy();
  });

  it('should reload when dynamic import rejection occurs', () => {
    render(<ChunkLoadErrorHandler />);

    const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new Error('Failed to fetch dynamically imported module: /_next/static/chunks/pages/users.js'),
    });
    window.dispatchEvent(rejectionEvent);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('should reload when stylesheet fails to load', () => {
    render(<ChunkLoadErrorHandler />);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://opsknight.com/_next/static/css/abc123.css';

    const errorEvent = new Event('error', { bubbles: true });
    Object.defineProperty(errorEvent, 'target', { value: link, enumerable: true });
    window.dispatchEvent(errorEvent);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('should throttle reloads within 15 seconds to prevent reload loops', () => {
    sessionStorage.setItem('opsknight_chunk_reload_timestamp', String(Date.now()));
    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'ChunkLoadError: Loading chunk 123 failed',
    });
    window.dispatchEvent(errorEvent);

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('should ignore unrelated runtime errors', () => {
    render(<ChunkLoadErrorHandler />);

    const errorEvent = new ErrorEvent('error', {
      message: 'TypeError: Cannot read property of undefined',
    });
    window.dispatchEvent(errorEvent);

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
