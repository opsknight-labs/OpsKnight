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
      'getBusinessServiceGraph',
    ])
      expect(MCP_HANDLERS.has(id), id).toBe(true);
  });

  it('exposes health and impact reads as curated read-only tools', () => {
    for (const [id, tool] of [
      ['getBusinessService', 'business_service_get'],
      ['getBusinessServiceImpactTimeline', 'business_service_health'],
      ['listBusinessServiceIncidents', 'business_service_incidents'],
      ['getBusinessServiceGraph', 'business_service_graph'],
    ] as const) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation, id).toMatchObject({ status: 'CURATED', risk: 'R0', tool });
      expect(operation.actions, id).toEqual(['service.read']);
      expect(isMcpExecutable(operation), id).toBe(true);
    }
  });

  it('classifies scorecard, changes and SLA report reads and dispatches them to REST', () => {
    expect(MCP_OPERATION_MAP.get('listBusinessServiceChanges')).toMatchObject({
      status: 'CURATED',
      risk: 'R0',
      tool: 'business_service_changes',
      actions: ['service.read'],
    });
    for (const id of [
      'getBusinessServiceScorecardRubric',
      'getBusinessServiceScorecard',
      'getBusinessServiceSlaReport',
    ])
      expect(MCP_OPERATION_MAP.get(id), id).toMatchObject({ status: 'DISCOVERABLE', risk: 'R0' });
    for (const id of [
      'getBusinessServiceScorecardRubric',
      'getBusinessServiceScorecard',
      'listBusinessServiceChanges',
      'getBusinessServiceSlaReport',
    ])
      expect(MCP_HANDLERS.has(id), id).toBe(true);
    // Organization configuration stays with administrators in Settings or REST.
    expect(MCP_OPERATION_MAP.get('updateBusinessServiceScorecardRubric')?.status).toBe(
      'UNSUPPORTED_WITH_REASON'
    );
  });

  it('keeps business-service writes behind human approval', () => {
    for (const id of [
      'createBusinessService',
      'updateBusinessService',
      'markIncidentBusinessServiceImpact',
      'unmarkIncidentBusinessServiceImpact',
      'createBusinessServiceCustomerReport',
      'notifyIncidentStakeholders',
    ]) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation, id).toMatchObject({ status: 'APPROVAL_REQUIRED', risk: 'R2', tool: null });
      expect(isMcpExecutable(operation), id).toBe(false);
      expect(MCP_HANDLERS.has(id), id).toBe(false);
      expect(MCP_APPROVAL_HANDLERS.has(id), id).toBe(true);
    }
  });

  it('keeps deletion and status-page layout out of assistants', () => {
    for (const id of ['deleteBusinessService', 'setStatusPageBusinessServices']) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation.status, id).toBe('UNSUPPORTED_WITH_REASON');
      expect(isMcpExecutable(operation), id).toBe(false);
      expect(MCP_HANDLERS.has(id), id).toBe(false);
    }
  });
});
