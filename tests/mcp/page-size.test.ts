import { describe, expect, it } from 'vitest';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import { MCP_MAX_PAGE_SIZE, mcpPageSize } from '@/lib/mcp/core/execution';

const limitOf = (operation: (typeof MCP_CATALOG)[number]) =>
  (
    operation.inputSchema.properties.query as
      { properties?: { limit?: { default?: number } } } | undefined
  )?.properties?.limit;

describe('MCP page size', () => {
  const paged = MCP_CATALOG.filter(operation => operation.kind === 'list' && limitOf(operation));

  it('applies the default each operation advertises when limit is omitted', () => {
    expect(paged.length).toBeGreaterThan(5);
    for (const operation of paged) {
      const advertised = limitOf(operation)!.default;
      expect(mcpPageSize(operation, null), operation.operationId).toBe(advertised ?? 20);
    }
  });

  it('applies a requested limit within 1..50 and rejects others', () => {
    const operation = MCP_CATALOG.find(item => item.operationId === 'listIncidents')!;
    expect(mcpPageSize(operation, '5')).toBe(5);
    expect(mcpPageSize(operation, String(MCP_MAX_PAGE_SIZE))).toBe(MCP_MAX_PAGE_SIZE);
    for (const bad of ['0', '51', '2.5', 'x'])
      expect(() => mcpPageSize(operation, bad)).toThrow('MCP_INVALID_PAGE_SIZE');
  });

  it('applies no page size to operations that do not page', () => {
    const operation = MCP_CATALOG.find(item => item.operationId === 'getIncident')!;
    expect(mcpPageSize(operation, null)).toBeUndefined();
  });
});
