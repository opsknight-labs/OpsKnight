import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const unsubscribeByToken = vi.hoisted(() => vi.fn());
vi.mock('@/lib/status-pages/unsubscribe', () => ({ unsubscribeByToken }));

import { POST } from '@/app/api/status/subscriptions/unsubscribe/one-click/[token]/route';

function oneClick(body: string, token = 'tok_123') {
  const req = new NextRequest(
    `https://app.example.com/api/status/subscriptions/unsubscribe/one-click/${token}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }
  );
  return POST(req, { params: Promise.resolve({ token }) });
}

describe('RFC 8058 one-click unsubscribe', () => {
  beforeEach(() => unsubscribeByToken.mockReset());

  it('unsubscribes on List-Unsubscribe=One-Click and returns 200 with no redirect', async () => {
    unsubscribeByToken.mockResolvedValueOnce({ id: 'sub_1' });
    const res = await oneClick('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(unsubscribeByToken).toHaveBeenCalledWith('tok_123');
  });

  it('answers identically for unknown tokens so tokens cannot be probed', async () => {
    unsubscribeByToken.mockResolvedValueOnce(null);
    const res = await oneClick('List-Unsubscribe=One-Click', 'unknown');
    expect(res.status).toBe(200);
  });

  it('rejects requests without the one-click body (e.g. link scanners)', async () => {
    const res = await oneClick('foo=bar');
    expect(res.status).toBe(400);
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });
});
