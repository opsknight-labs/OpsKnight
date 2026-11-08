import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn().mockResolvedValue(null) }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.opsnite.com');
  vi.stubEnv('NEXTAUTH_URL', 'https://www.opsnite.com');
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-characters-long');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function run(path: string) {
  const { default: middleware } = await import('@/middleware');
  return middleware(new NextRequest(`https://www.opsnite.com${path}`));
}
const redirectsToLogin = (response: Response) =>
  response.status >= 300 &&
  response.status < 400 &&
  (response.headers.get('location') ?? '').includes('/login');

it.each([
  '/.well-known/openid-configuration',
  '/.well-known/openid-configuration/oauth/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource/mcp',
])('does not send the unauthenticated discovery request %s to the sign-in page', async path => {
  // A client probing for OIDC metadata got the sign-in page with 200 HTML, which it cannot tell
  // from a document. These paths are public; an unknown one now falls through to a plain 404.
  expect(redirectsToLogin(await run(path))).toBe(false);
});

it('still sends an unauthenticated visit to a private page to sign in', async () => {
  expect(redirectsToLogin(await run('/incidents'))).toBe(true);
});
