import { describe, expect, it } from 'vitest';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import { compactRequiredArguments, requiredArgumentsOf } from '@/lib/mcp/protocol/argument-hints';

const operation = (operationId: string) =>
  MCP_CATALOG.find(entry => entry.operationId === operationId)!;

describe('required argument hints', () => {
  it('names the path parameter of a read by id', () => {
    expect(requiredArgumentsOf(operation('getIncident').inputSchema)).toMatchObject({
      path: ['id'],
      body: false,
      idempotencyKey: false,
    });
  });

  it('asks for nothing on a plain list', () => {
    expect(compactRequiredArguments(operation('listServices').inputSchema)).toEqual({});
  });

  it('says a change needs an idempotency key, and a guarded one an ifMatch', () => {
    const resolve = requiredArgumentsOf(operation('resolveIncident').inputSchema);
    expect(resolve.path).toEqual(['id']);
    expect(resolve.idempotencyKey).toBe(true);
    const guarded = MCP_CATALOG.find(entry => requiredArgumentsOf(entry.inputSchema).ifMatch);
    expect(guarded).toBeDefined();
  });

  it('tolerates a missing or odd schema', () => {
    expect(requiredArgumentsOf(undefined)).toEqual({
      path: [],
      query: [],
      body: false,
      idempotencyKey: false,
      ifMatch: false,
    });
    expect(requiredArgumentsOf({ properties: { path: { required: 'id' } } }).path).toEqual([]);
  });

  it('agrees with the schema for every operation: each hint is a real required field', () => {
    for (const entry of MCP_CATALOG) {
      const hints = requiredArgumentsOf(entry.inputSchema);
      const properties = (entry.inputSchema as { properties?: Record<string, unknown> }).properties;
      for (const name of hints.path)
        expect(
          Object.keys(
            (properties?.path as { properties?: Record<string, unknown> }).properties ?? {}
          ),
          entry.operationId
        ).toContain(name);
    }
  });
});

describe('ifMatch', () => {
  it('is refused where the operation does not check revisions, and accepted where it does', async () => {
    const { validateOperationArgs } = await import('@/lib/mcp/core/execution');
    const key = 'abcdefghijklmnop1234';
    // addIncidentNote ignores If-Match: a stale value used to be accepted and the note applied.
    expect(() =>
      validateOperationArgs('addIncidentNote', {
        path: { id: 'inc_1' },
        body: { content: 'a note' },
        idempotencyKey: key,
        ifMatch: '"0"',
      })
    ).toThrow('MCP_INVALID_ARGUMENTS');
    // updateService checks revisions: the same field is normalised and kept.
    // (a reviewed operation, so validated as it is at commit: mode `approved`)
    const guarded = validateOperationArgs(
      'updateService',
      { path: { id: 'svc_1' }, body: { name: 'Renamed' }, idempotencyKey: key, ifMatch: '3' },
      true
    );
    expect(guarded.ifMatch).toBe('"3"');
  });
});
