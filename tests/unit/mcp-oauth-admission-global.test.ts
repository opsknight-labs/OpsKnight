import { beforeEach, describe, expect, it, vi } from 'vitest';

const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/rate-limit', () => rate);

import { admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';

const request = () => new Request('https://ops.example.com/oauth/mcp/token', { method: 'POST' });

describe('MCP OAuth admission', () => {
  beforeEach(() => {
    rate.checkRateLimit.mockReset();
    // The installation-wide ceiling is exhausted by anonymous junk.
    rate.checkRateLimit.mockImplementation(async (key: string) => ({
      allowed: !key.endsWith(':global'),
    }));
  });

  it('refuses anonymous requests once the global ceiling is spent', async () => {
    await expect(admitMcpOAuthRequest(request(), 'token')).rejects.toMatchObject({ status: 429 });
  });

  it('can charge only the peer bucket, leaving the global ceiling untouched', async () => {
    await expect(
      admitMcpOAuthRequest(request(), 'token', { chargeGlobal: false })
    ).resolves.toBeUndefined();
    expect(rate.checkRateLimit.mock.calls.map(([key]) => key)).not.toContainEqual(
      expect.stringContaining(':global')
    );
  });
});
