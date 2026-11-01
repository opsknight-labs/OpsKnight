import { describe, expect, it } from 'vitest';
import { compactResult, wireInputSchema, wireSchema } from '@/lib/mcp/protocol/wire';
import { MCP_CATALOG, mcpContractHash, mcpResponseSchema } from '@/lib/mcp/catalog';

describe('wire schema projection', () => {
  it('drops empty fragments but never data values or property names', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      $defs: {},
      required: [],
      properties: {
        required: { type: 'array', items: { type: 'string' }, default: [] },
        $schema: { type: 'string' },
        mode: { enum: [null, 'a'], default: null },
        nested: { type: 'object', properties: {}, required: [], $defs: {} },
      },
    };
    expect(wireSchema(schema)).toEqual({
      type: 'object',
      properties: {
        required: { type: 'array', items: { type: 'string' }, default: [] },
        $schema: { type: 'string' },
        mode: { enum: [null, 'a'], default: null },
        nested: { type: 'object', properties: {} },
      },
    });
  });

  it('omits empty, optional path and query envelopes only', () => {
    const empty = { type: 'object', additionalProperties: false, properties: {}, required: [] };
    expect(
      wireInputSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { ...empty, properties: { id: { type: 'string' } }, required: ['id'] },
          query: empty,
          body: empty,
        },
        $defs: {},
        required: ['path'],
      })
    ).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: { type: 'object', additionalProperties: false, properties: {} },
      },
      required: ['path'],
    });
  });

  it('leaves the hashed catalog schemas untouched', () => {
    for (const operation of MCP_CATALOG) {
      const before = JSON.stringify(operation.inputSchema);
      wireInputSchema(operation.inputSchema);
      expect(JSON.stringify(operation.inputSchema)).toBe(before);
      expect(mcpContractHash(operation)).toBe(operation.contractSha256);
    }
  });

  it('describes only the success body with every reference resolved', () => {
    const operation = MCP_CATALOG.find(item => item.operationId === 'listServices')!;
    const schema = mcpResponseSchema(operation)!;
    const text = JSON.stringify(schema);
    expect(text).not.toContain('#/components');
    expect(text).not.toContain('X-RateLimit');
    expect(text).not.toContain('ProblemError');
    expect((schema.properties as Record<string, unknown>).data).toBeDefined();
    expect((schema.$defs as Record<string, unknown>).Service).toBeDefined();
    for (const item of MCP_CATALOG)
      expect(JSON.stringify(mcpResponseSchema(item) ?? {}), item.operationId).not.toContain(
        '#/components'
      );
  });
});

describe('compactResult', () => {
  it('drops null and empty members but keeps data, array positions and evidence', () => {
    const evidence = { etag: null, redactedFields: [], warnings: ['untrusted'] };
    expect(
      compactResult({
        data: [{ id: 'a', assigneeId: null, tags: [], meta: {}, count: 0, flag: false, note: '' }],
        nextCursor: null,
        nested: { inner: { gone: null } },
        list: [null, []],
        evidence,
      })
    ).toEqual({
      data: [{ id: 'a', count: 0, flag: false, note: '' }],
      list: [null, []],
      evidence,
    });
    expect(compactResult({ data: [], evidence })).toEqual({ data: [], evidence });
    expect(compactResult({ data: null, evidence })).toEqual({ data: null, evidence });
  });

  it('keeps a __proto__ key from domain JSON as an own member', () => {
    const parsed = JSON.parse('{"data":{"__proto__":{"polluted":true},"x":1}}');
    const compact = compactResult(parsed) as { data: Record<string, unknown> };
    expect(Object.getPrototypeOf(compact.data)).toBe(Object.prototype);
    expect(Object.keys(compact.data)).toEqual(['__proto__', 'x']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
