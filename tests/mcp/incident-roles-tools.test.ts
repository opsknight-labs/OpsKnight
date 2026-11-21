import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpExecutable } from '@/lib/mcp/catalog';
import { MCP_HANDLERS } from '@/lib/mcp/operations/handlers';

describe('incident role MCP tools', () => {
  it('exposes the roster read and role assignment as reviewed named tools', () => {
    const list = MCP_OPERATION_MAP.get('listIncidentRoles')!;
    const assign = MCP_OPERATION_MAP.get('setIncidentRole')!;
    expect(list).toMatchObject({ status: 'CURATED', risk: 'R0', tool: 'incident_roles_list' });
    expect(assign).toMatchObject({ status: 'CURATED', risk: 'R1', tool: 'incident_role_assign' });
    expect(list.actions).toEqual(['incident.read']);
    expect(assign.actions).toEqual(['incident.acknowledge']);
    expect(isMcpExecutable(list)).toBe(true);
    expect(isMcpExecutable(assign)).toBe(true);
  });

  it('dispatches to the REST routes and takes a closed role key', () => {
    for (const id of ['listIncidentRoles', 'setIncidentRole', 'clearIncidentRole'])
      expect(MCP_HANDLERS.has(id), id).toBe(true);
    const schema = JSON.stringify(MCP_OPERATION_MAP.get('setIncidentRole')!.inputSchema);
    for (const key of ['COMMANDER', 'OPS_LEAD', 'COMMS_LEAD', 'SCRIBE'])
      expect(schema).toContain(key);
    expect(schema).toContain('idempotencyKey');
  });

  it('keeps clearing a role out of the named tool list', () => {
    expect(MCP_OPERATION_MAP.get('clearIncidentRole')).toMatchObject({
      status: 'DISCOVERABLE',
      tool: null,
    });
  });
});
