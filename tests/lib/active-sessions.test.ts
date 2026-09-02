import { describe, it, expect } from 'vitest';
import { parseUserAgent } from '@/lib/active-sessions';

describe('active-sessions: parseUserAgent', () => {
  it('correctly detects Microsoft Edge on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Microsoft Edge');
    expect(result.os).toBe('Windows');
    expect(result.deviceType).toBe('desktop');
    expect(result.isMobile).toBe(false);
  });

  it('correctly detects Google Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Google Chrome');
    expect(result.os).toBe('macOS');
    expect(result.deviceType).toBe('desktop');
    expect(result.isMobile).toBe(false);
  });

  it('correctly detects Apple Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Apple Safari');
    expect(result.os).toBe('iOS');
    expect(result.deviceType).toBe('mobile');
    expect(result.isMobile).toBe(true);
  });

  it('correctly detects Mozilla Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Mozilla Firefox');
    expect(result.os).toBe('Linux');
    expect(result.deviceType).toBe('desktop');
    expect(result.isMobile).toBe(false);
  });

  it('gracefully handles missing or empty userAgent', () => {
    const result = parseUserAgent(null);
    expect(result.browser).toBe('Web Browser');
    expect(result.deviceType).toBe('desktop');
  });
});
