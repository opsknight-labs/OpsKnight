import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/mcp/route';
import { boundMcpResponse } from '@/lib/mcp/core/response';
import { assertMcpHost } from '@/lib/mcp/auth/http';

// Parsing-envelope tests use an authenticated principal. Anonymous callers must now
// fail authentication before their request bodies are read.
vi.mock('@/lib/mcp/auth/principal', () => ({
  authenticateMcp: vi.fn(async () => ({
    auth: { actor: { id: 'user' } },
    policy: { maxInFlight: 2 },
  })),
  chargeMcpRequest: vi.fn(),
  resolveMcpGrant: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());
describe('MCP transport boundaries', () => {
  it('accepts a pinned ingress Host with an internal listener URL', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'https://ops.example.test');
    expect(() =>
      assertMcpHost(
        new Request('http://localhost:3000/mcp', {
          headers: { host: 'ops.example.test', origin: 'https://ops.example.test' },
        })
      )
    ).not.toThrow();
    const rejectedHeaders: Record<string, string>[] = [
      { host: 'attacker.test', 'x-forwarded-host': 'ops.example.test' },
      { host: 'ops.example.test:3000' },
      { host: 'ops.example.test', origin: 'https://attacker.test' },
    ];
    for (const headers of rejectedHeaders) {
      expect(() => assertMcpHost(new Request('http://localhost:3000/mcp', { headers }))).toThrow();
    }
    expect(() => assertMcpHost(new Request('https://attacker.test/mcp'))).toThrow();
  });
  it('accepts only the exact extra Host values an operator listed for a rewriting proxy', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'https://ops.example.test');
    vi.stubEnv('MCP_ALLOWED_HOSTS', 'opsknight.internal:3000, OpsKnight-Svc ,https://bad/path');
    const withHost = (headers: Record<string, string>) => () =>
      assertMcpHost(new Request('http://localhost:3000/mcp', { headers }));
    expect(withHost({ host: 'opsknight.internal:3000' })).not.toThrow();
    expect(withHost({ host: 'opsknight-svc' })).not.toThrow();
    // Not listed, a different port, and a forwarded header are all still refused.
    expect(withHost({ host: 'attacker.test' })).toThrow();
    expect(withHost({ host: 'opsknight.internal:9999' })).toThrow();
    expect(withHost({ host: 'attacker.test', 'x-forwarded-host': 'opsknight-svc' })).toThrow();
    expect(withHost({ host: 'bad' })).toThrow();
    // A browser page on another site is refused even when it reaches a listed Host.
    expect(withHost({ host: 'opsknight-svc', origin: 'https://attacker.test' })).toThrow();
  });
  it.each([
    ['{', -32700],
    ['[]', -32600],
    ['{"jsonrpc":"2.0","id":1}', -32600],
  ] as const)('distinguishes parse errors from invalid requests: %s', async (body, code) => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'http://localhost:3000');
    const response = await POST(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
  });
  it('bounds the complete UTF-8 encoded envelope, including duplicate fallbacks and escaping', async () => {
    const data = { text: '雪"'.repeat(100) };
    const envelope = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data },
    });
    const logicalBytes = Buffer.byteLength(JSON.stringify(data));
    expect(Buffer.byteLength(envelope)).toBeGreaterThan(logicalBytes);
    await expect(boundMcpResponse(new Response(envelope), logicalBytes)).rejects.toMatchObject({
      code: 'MCP_RESULT_BUDGET_EXCEEDED',
      status: 413,
    });
    const response = await boundMcpResponse(new Response(envelope), Buffer.byteLength(envelope));
    expect(await response.text()).toBe(envelope);
  });
});
