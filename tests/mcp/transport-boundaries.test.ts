import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/mcp/route';
import { boundMcpResponse } from '@/lib/mcp/core/response';
import { assertMcpHost } from '@/lib/mcp/auth/http';

// Parsing-envelope tests use an authenticated principal. Anonymous callers must now
// fail authentication before their request bodies are read.
vi.mock('@/lib/mcp/auth/principal', () => ({
  authenticateMcp: vi.fn(async () => ({ policy: { maxInFlight: 2 } })),
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
