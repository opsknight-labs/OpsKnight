import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpExecutable } from '@/lib/mcp/catalog';
import { MCP_APPROVAL_HANDLERS, MCP_HANDLERS } from '@/lib/mcp/operations/handlers';

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
      'listBusinessServiceIncidents',
      'getBusinessServiceImpactTimeline',
    ])
      expect(MCP_HANDLERS.has(id), id).toBe(true);
  });

  it('exposes health and impact reads as curated read-only tools', () => {
    for (const [id, tool] of [
      ['getBusinessService', 'business_service_get'],
      ['getBusinessServiceImpactTimeline', 'business_service_health'],
      ['listBusinessServiceIncidents', 'business_service_incidents'],
    ] as const) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation, id).toMatchObject({ status: 'CURATED', risk: 'R0', tool });
      expect(operation.actions, id).toEqual(['service.read']);
      expect(isMcpExecutable(operation), id).toBe(true);
    }
  });

  it('keeps marking business impact behind human approval', () => {
    for (const id of ['markIncidentBusinessServiceImpact', 'unmarkIncidentBusinessServiceImpact']) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation.status, id).toBe('APPROVAL_REQUIRED');
      expect(isMcpExecutable(operation), id).toBe(false);
      expect(MCP_HANDLERS.has(id), id).toBe(false);
      expect(MCP_APPROVAL_HANDLERS.has(id), id).toBe(true);
    }
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
