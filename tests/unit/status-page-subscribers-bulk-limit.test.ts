import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'usr-admin-1', role: 'ADMIN' }),
}));

const mockFindMany = vi.fn().mockResolvedValue([{ id: 'sub-1', email: 'test@example.com' }]);
const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockFindFirst = vi.fn().mockResolvedValue({ id: 'sub-1', email: 'test@example.com' });

vi.mock('@/lib/prisma', () => ({
  default: {
    statusPageSubscription: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    notification: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation(promises => Promise.all(promises)),
  },
}));

import { DELETE } from '@/app/api/status-page/subscribers/route';

describe('DELETE /api/status-page/subscribers bulk limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects bulk requests exceeding 250 unique IDs', async () => {
    const ids = Array.from({ length: 251 }, (_, i) => `sub-${i}`);
    const req = new NextRequest('http://localhost:3000/api/status-page/subscribers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, statusPageId: 'page-1' }),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot process more than 250 subscribers');
  });

  it('deduplicates subscriber IDs so duplicate entries count as one towards the limit', async () => {
    // 300 entries, but only 2 unique IDs
    const ids = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 'sub-1' : 'sub-2'));
    const req = new NextRequest('http://localhost:3000/api/status-page/subscribers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, statusPageId: 'page-1' }),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
