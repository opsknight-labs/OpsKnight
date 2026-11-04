import { describe, expect, it } from 'vitest';
import { forcedSignOutUrl, signOutDestination } from '@/lib/app-routes';
import { relativeToAppOrigin, safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { resolveStatusAuthReturn, statusAuthStartUrl } from '@/lib/status-pages/status-auth-return';

// WAFs block absolute URLs in query strings (OWASP CRS 931120/931130, AWS
// GenericRFI_QUERYARGUMENTS) and values encoded more than once (CRS 920230).
function assertWafFriendly(url: string) {
  const query = url.split('?').slice(1).join('?');
  expect(query).not.toMatch(/%25/);
  expect(decodeURIComponent(query)).not.toMatch(/https?:\/\//i);
}

describe('forcedSignOutUrl', () => {
  it('goes straight to the sign-out page with flat parameters', () => {
    const url = forcedSignOutUrl('mobile', { error: 'SessionExpired', callbackUrl: '/m' });
    expect(url).toBe('/auth/signout?surface=mobile&error=SessionExpired&callbackUrl=%2Fm');
    assertWafFriendly(url);
  });

  it('round-trips to the login page of the same surface', () => {
    const params = (url: string) => new URLSearchParams(url.split('?')[1]);
    expect(
      signOutDestination(
        params(forcedSignOutUrl('mobile', { error: 'SessionExpired', callbackUrl: '/m' }))
      )
    ).toBe('/m/login?callbackUrl=%2Fm&error=SessionExpired');
    expect(
      signOutDestination(params(forcedSignOutUrl('desktop', { error: 'SessionExpired' })))
    ).toBe('/login?error=SessionExpired');
    expect(signOutDestination(params(forcedSignOutUrl('mobile')))).toBe('/m/login');
  });
});

describe('signOutDestination', () => {
  it('keeps the existing callbackUrl behaviour without a surface', () => {
    expect(signOutDestination(new URLSearchParams())).toBe('/login');
    expect(signOutDestination(new URLSearchParams({ callbackUrl: '/incidents' }))).toBe(
      '/incidents'
    );
    expect(signOutDestination(new URLSearchParams({ callbackUrl: 'https://evil.example/' }))).toBe(
      '/login'
    );
  });

  it('drops unsafe callbacks and error codes in forced sign-outs', () => {
    expect(
      signOutDestination(
        new URLSearchParams({
          surface: 'mobile',
          callbackUrl: '//evil.example',
          error: '<script>',
        })
      )
    ).toBe('/m/login');
  });
});

describe('status-page SSO return target', () => {
  const appUrl = 'https://ops.example.com';

  it('carries a bare host and relative path, never a full URL', () => {
    const url = statusAuthStartUrl(appUrl, {
      pageId: 'page_1',
      host: 'status.customer.com',
      scheme: 'https',
      path: '/postmortems/inc_1',
    });
    expect(url).toBe(
      'https://ops.example.com/status-auth/start?pageId=page_1&returnHost=status.customer.com&returnTo=/postmortems/inc_1'
    );
    assertWafFriendly(url);
  });

  it('stays WAF-friendly after the login bounce nests it in callbackUrl', () => {
    const start = new URL(
      statusAuthStartUrl(appUrl, { pageId: 'page_1', host: 'status.customer.com' })
    );
    const login = new URL(`${appUrl}/login`);
    login.searchParams.set('callbackUrl', start.pathname + start.search);
    assertWafFriendly(login.toString());
  });

  it('rebuilds the return URL from the new parameters', () => {
    const resolve = (url: string) =>
      resolveStatusAuthReturn(new URL(url).searchParams, appUrl)?.toString();
    expect(resolve(statusAuthStartUrl(appUrl, { pageId: 'p', host: 'status.customer.com' }))).toBe(
      'https://status.customer.com/'
    );
    expect(
      resolve(
        statusAuthStartUrl(appUrl, {
          pageId: 'p',
          host: 'status.localhost:3000',
          scheme: 'http',
          path: '/postmortems/inc_1',
        })
      )
    ).toBe('http://status.localhost:3000/postmortems/inc_1');
  });

  it('accepts a host that carries its default port', () => {
    const params = new URLSearchParams({ pageId: 'p', returnHost: 'status.customer.com:443' });
    expect(resolveStatusAuthReturn(params, appUrl)?.toString()).toBe(
      'https://status.customer.com/'
    );
  });

  it('still accepts the legacy absolute returnTo', () => {
    const params = new URLSearchParams({
      pageId: 'p',
      returnTo: 'https://status.customer.com/postmortems/inc_1',
    });
    expect(resolveStatusAuthReturn(params, appUrl)?.toString()).toBe(
      'https://status.customer.com/postmortems/inc_1'
    );
  });

  it('rejects hosts and paths that would smuggle another origin', () => {
    const resolve = (returnHost: string, returnTo?: string) =>
      resolveStatusAuthReturn(
        new URLSearchParams({ pageId: 'p', returnHost, ...(returnTo ? { returnTo } : {}) }),
        appUrl
      );
    expect(resolve('evil.example@status.customer.com')).toBeNull();
    expect(resolve('status.customer.com/evil')).toBeNull();
    expect(resolve('status.customer.com', '//evil.example/')).toBeNull();
    expect(resolve('status.customer.com', 'https://evil.example/')).toBeNull();
    expect(resolve('status.customer.com', '/\\evil.example')).toBeNull();
  });
});

describe('relativeToAppOrigin', () => {
  const origin = 'https://ops.example.com';

  it('keeps same-origin deep links that NextAuth made absolute', () => {
    const value = relativeToAppOrigin('https://ops.example.com/incidents?tab=open', origin);
    expect(value).toBe('/incidents?tab=open');
    expect(safeInternalCallbackUrl(value, '/')).toBe('/incidents?tab=open');
  });

  it('leaves other origins for the policy to reject', () => {
    for (const raw of [
      'https://evil.example/incidents',
      'https://ops.example.com.evil.example/',
      'https://user:pass@ops.example.com/',
      'http://ops.example.com/incidents',
    ]) {
      expect(safeInternalCallbackUrl(relativeToAppOrigin(raw, origin), '/')).toBe('/');
    }
  });
});
