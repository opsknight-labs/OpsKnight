import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpExecutable } from '@/lib/mcp/catalog';
import { MCP_HANDLERS } from '@/lib/mcp/operations/handlers';

describe('business service MCP tools', () => {
  it('names the catalog read as a reviewed read-only tool', () => {
    const list = MCP_OPERATION_MAP.get('listBusinessServices')!;
    expect(list).toMatchObject({ status: 'CURATED', risk: 'R0', tool: 'business_services_list' });
    expect(list.actions).toEqual(['service.read']);
    expect(isMcpExecutable(list)).toBe(true);
  });

  it('dispatches every read to its REST route', () => {
    for (const id of [
      'listBusinessServices',
      'getBusinessService',
      'getStatusPageBusinessServices',
    ])
      expect(MCP_HANDLERS.has(id), id).toBe(true);
  });

  it('keeps configuration writes out of assistants for now', () => {
    for (const id of [
      'createBusinessService',
      'updateBusinessService',
      'deleteBusinessService',
      'setStatusPageBusinessServices',
    ]) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation.status, id).toBe('UNSUPPORTED_WITH_REASON');
      expect(isMcpExecutable(operation), id).toBe(false);
      expect(MCP_HANDLERS.has(id), id).toBe(false);
    }
  });
});
