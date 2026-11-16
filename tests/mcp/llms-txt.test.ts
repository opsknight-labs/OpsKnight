import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  policy: null as { enabled: boolean } | null,
  origin: 'https://ops.example.com' as string | Error,
}));

vi.mock('@/lib/mcp/auth/discovery-policy', () => ({
  loadDiscoveryPolicy: async () => state.policy,
}));
vi.mock('@/lib/mcp/auth/config', () => ({
  loadMcpRuntime: async () => undefined,
  mcpOrigin: () => {
    if (state.origin instanceof Error) throw state.origin;
    return state.origin;
  },
}));

import { GET } from '@/app/llms.txt/route';

async function body() {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  return response.text();
}

describe('/llms.txt', () => {
  beforeEach(() => {
    state.policy = { enabled: true };
    state.origin = 'https://ops.example.com';
    delete process.env.MCP_FORCE_DISABLED;
  });

  it('describes the MCP endpoint and discovery URLs when MCP is on', async () => {
    const text = await body();
    expect(text).toContain('- Endpoint: https://ops.example.com/mcp');
    expect(text).toContain('https://ops.example.com/.well-known/oauth-protected-resource/mcp');
    expect(text).toContain(
      'https://ops.example.com/.well-known/oauth-authorization-server/oauth/mcp'
    );
    expect(text).toContain('guides/mcp/clients/README.md');
  });

  it.each([
    ['no policy', () => (state.policy = null)],
    ['policy off', () => (state.policy = { enabled: false })],
    ['the deployment kill switch is on', () => (process.env.MCP_FORCE_DISABLED = 'true')],
    ['origin not configured', () => (state.origin = new Error('MCP_ORIGIN_REQUIRED'))],
  ])('leaves out every MCP fact when %s', async (_name, arrange) => {
    arrange();
    const text = await body();
    expect(text).toContain('not enabled on this installation');
    expect(text).not.toContain('/mcp (');
    expect(text).not.toContain('.well-known');
    expect(text).not.toContain('ops.example.com');
  });
});
