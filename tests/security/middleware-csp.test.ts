import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '../../src/middleware';

function request() {
  return new NextRequest('https://ops.example.com/api/health', {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
}

describe('middleware Content-Security-Policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not allow unsafe-eval in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await middleware(request());
    const csp = response.headers.get('Content-Security-Policy') || '';

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('retains unsafe-eval only for development HMR compatibility', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await middleware(request());
    const csp = response.headers.get('Content-Security-Policy') || '';

    expect(csp).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
  });
});
