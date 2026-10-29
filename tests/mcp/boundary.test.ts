import { describe, expect, it, vi } from 'vitest';
import { CostBudget, acquireMcpSlot } from '@/lib/mcp/core/budget';
import { rejectDuplicateJsonKeys, readMcpBody } from '@/lib/mcp/protocol/input';
import { projectMcpData } from '@/lib/mcp/core/projection';
import { MCP_CATALOG, isMcpExecutable } from '@/lib/mcp/catalog';
import { validateOperationArgs, canDiscover } from '@/lib/mcp/core/execution';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  internalV2Auth,
  internalV2Admission,
  withInternalV2Invocation,
} from '@/lib/api-v2/internal-context';

describe('MCP boundary', () => {
  it('classifies exactly the live registry and denies R3', () => {
    expect(MCP_CATALOG.map(item => item.operationId).sort()).toEqual(
      V2_OPERATIONS.map(item => item.operationId).sort()
    );
    expect(
      MCP_CATALOG.filter(item => item.risk === 'R3').every(item => !isMcpExecutable(item))
    ).toBe(true);
  });
  it('validates generated operation schemas strictly', () => {
    expect(() =>
      validateOperationArgs('getIncident', { path: { id: 'incident-1' } })
    ).not.toThrow();
    expect(() =>
      validateOperationArgs('getIncident', { path: { id: 'incident-1', injected: true } })
    ).toThrow();
    expect(() => validateOperationArgs('getIncident', { url: 'http://metadata/' })).toThrow();
    expect(() => validateOperationArgs('issueServiceAccountToken', {})).toThrow();
    expect(() => validateOperationArgs('executeRunbook', {})).toThrow();
    expect(() => validateOperationArgs('__proto__', {})).toThrow();
  });
  it('compiles every exposed schema with only local bounded references', () => {
    const validator = new Ajv2020({ strict: false });
    addFormats(validator);
    for (const operation of MCP_CATALOG.filter(isMcpExecutable)) {
      expect(() => validator.compile(operation.inputSchema), operation.operationId).not.toThrow();
    }
  });
  it('never discovers operations from role alone without explicit grant scope', () => {
    const incident = MCP_CATALOG.find(item => item.operationId === 'getIncident')!;
    expect(
      canDiscover(
        { id: 'u', role: 'ADMIN', status: 'ACTIVE', teamIds: [], apiKey: { id: 'g', scopes: [] } },
        incident
      )
    ).toBe(false);
    expect(
      canDiscover(
        {
          id: 'u',
          role: 'ADMIN',
          status: 'DISABLED',
          teamIds: [],
          apiKey: { id: 'g', scopes: ['incidents:read'] },
        },
        incident
      )
    ).toBe(false);
  });
  it('rejects duplicate, escaped duplicate, prototype keys and deep JSON', () => {
    for (const text of [
      '{"x":1,"x":2}',
      '{"x":1,"\\u0078":2}',
      '{"__proto__":{}}',
      '['.repeat(25) + ']'.repeat(25),
    ])
      expect(() => rejectDuplicateJsonKeys(text)).toThrow();
    expect(() => rejectDuplicateJsonKeys('{"x":{"x":2},"y":"a\\\"b"}')).not.toThrow();
  });
  it('bounds actual streamed bodies without trusting Content-Length', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 'x'.repeat(65536) }),
    });
    await expect(readMcpBody(request)).rejects.toThrow('MCP_BODY_TOO_LARGE');
    await expect(
      readMcpBody(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '[]',
        })
      )
    ).rejects.toThrow();
  });
  it('bounds costs, time, output and cancellation', () => {
    const budget = new CostBudget(1, 5);
    budget.consumeOperation();
    expect(() => budget.consumeOperation()).toThrow();
    expect(() => budget.consumeResult({ large: true })).toThrow();
    vi.useFakeTimers();
    const timed = new CostBudget();
    vi.advanceTimersByTime(10001);
    expect(() => timed.check()).toThrow();
    vi.useRealTimers();
    const controller = new AbortController();
    controller.abort();
    expect(() => new CostBudget(8, 100, controller.signal).check()).toThrow();
  });
  it('releases load-shedding slots exactly once', () => {
    const release = acquireMcpSlot(1);
    expect(() => acquireMcpSlot(1)).toThrow('MCP_BUSY');
    release();
    release();
    const second = acquireMcpSlot(1);
    second();
  });
  it('redacts nested credentials, PII, bearer strings and capability URLs', () => {
    const redacted: string[] = [];
    const result = projectMcpData(
      {
        email: 'private@example.test',
        child: { secret: 'sensitive' },
        description: 'Bearer abcdef https://storage.test/file?signature=123',
      },
      redacted
    );
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(JSON.stringify(result)).not.toContain('signature=');
    expect(JSON.stringify(result)).not.toContain('abcdef');
    expect(redacted).toEqual(['/email', '/child/secret', '/description']);
  });
  it('cannot forge internal authorization through headers or another Request', async () => {
    const request = new Request('http://local', { headers: { 'x-mcp-actor': 'admin' } });
    const other = new Request('http://local');
    const auth = {
      actor: { id: 'u', role: 'USER' as const, status: 'ACTIVE' as const, teamIds: [] },
      apiKey: {
        id: 'g',
        name: 'MCP',
        prefix: 'mcp',
        tokenHash: '',
        userId: 'u',
        scopes: [],
        isServiceAccount: false,
      },
    };
    expect(internalV2Auth(request)).toBeUndefined();
    await withInternalV2Invocation(request, auth, async () => {
      expect(internalV2Auth(request)).toEqual(auth);
      expect(internalV2Auth(other)).toBeUndefined();
      expect(internalV2Admission('g')).toBe(true);
      expect(internalV2Admission('forged')).toBe(false);
    });
    expect(internalV2Auth(request)).toBeUndefined();
  });
});
