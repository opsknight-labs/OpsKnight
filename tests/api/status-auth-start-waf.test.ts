import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { statusAuthStartUrl } from '@/lib/status-pages/status-auth-return';

const mocks = vi.hoisted(() => ({ session: vi.fn(), findFirst: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/prisma', () => ({ default: { statusPage: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/app-config', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://ops.example.com'),
}));
vi.mock('@/lib/status-pages/status-auth', () => ({
  createStatusAuthTicket: vi.fn(async ({ returnTo }: { returnTo: string }) => `ticket:${returnTo}`),
}));

import { GET } from '@/app/status-auth/start/route';

const appUrl = 'https://ops.example.com';
const page = {
  id: 'page_1',
  slug: 'acme',
  customDomain: 'status.customer.com',
  subdomain: null,
  isDefault: false,
};

function hasNoUrlInQuery(location: string) {
  const query = location.split('?').slice(1).join('?');
  return !/%25/.test(query) && !/https?:\/\//i.test(decodeURIComponent(query));
}

describe('GET /status-auth/start (WAF-friendly return target)', () => {
  beforeEach(() => {
    mocks.session.mockReset();
    mocks.findFirst.mockReset().mockResolvedValue(page);
  });

  it('bounces a logged-out viewer through login without a URL in the query', async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(
      new NextRequest(
        statusAuthStartUrl(appUrl, {
          pageId: 'page_1',
          host: 'status.customer.com',
          path: '/postmortems/inc_1',
        })
      )
    );
    const location = res.headers.get('location')!;
    expect(location.startsWith(`${appUrl}/login?callbackUrl=`)).toBe(true);
    expect(hasNoUrlInQuery(location)).toBe(true);
  });

  it('sends a signed-in viewer to the status host callback', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(
      new NextRequest(
        statusAuthStartUrl(appUrl, {
          pageId: 'page_1',
          host: 'status.customer.com',
          path: '/postmortems/inc_1',
        })
      )
    );
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://status.customer.com');
    expect(location.pathname).toBe('/status-auth/callback');
    expect(location.searchParams.get('returnTo')).toBe('/postmortems/inc_1');
  });

  it('keeps accepting the legacy absolute returnTo', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(
      new NextRequest(
        `${appUrl}/status-auth/start?pageId=page_1&returnTo=${encodeURIComponent('https://status.customer.com/')}`
      )
    );
    expect(new URL(res.headers.get('location')!).origin).toBe('https://status.customer.com');
  });

  it('still refuses hosts that do not belong to the page', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(
      new NextRequest(statusAuthStartUrl(appUrl, { pageId: 'page_1', host: 'evil.example' }))
    );
    expect(res.status).toBe(400);
  });

  it('rejects a malformed returnHost', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(
      new NextRequest(
        `${appUrl}/status-auth/start?pageId=page_1&returnHost=${encodeURIComponent('evil.example@status.customer.com')}`
      )
    );
    expect(res.status).toBe(400);
  });
});
