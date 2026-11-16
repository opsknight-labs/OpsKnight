import { describe, expect, it } from 'vitest';
import {
  effectiveDisabledMcpCapabilities,
  roleDisabledMcpCapabilities,
} from '@/lib/mcp/auth/effective-capabilities';
import {
  MCP_CAPABILITY_DOMAINS,
  resolveDisabledMcpCapabilities,
} from '@/lib/mcp/catalog/capabilities';

describe('effectiveDisabledMcpCapabilities', () => {
  it('is the union of the global, role and assistant lists', () => {
    const source = {
      disabledCapabilities: ['listTeams'],
      roleDisabledCapabilities: { USER: ['listIncidents'], ADMIN: ['getService'] },
      clientDisabledCapabilities: ['domain:runbooks', 'listTeams'],
    };
    expect(effectiveDisabledMcpCapabilities(source, 'USER').sort()).toEqual([
      'domain:runbooks',
      'listIncidents',
      'listTeams',
    ]);
    expect(effectiveDisabledMcpCapabilities(source, 'ADMIN')).toContain('getService');
    expect(effectiveDisabledMcpCapabilities(source, 'ADMIN')).not.toContain('listIncidents');
    expect(effectiveDisabledMcpCapabilities({}, 'USER')).toEqual([]);
  });

  it('fails closed on a malformed role entry except for administrators', () => {
    const everything = MCP_CAPABILITY_DOMAINS.map(domain => `domain:${domain}`);
    for (const stored of ['x', 3, [1], ['listTeams'], { USER: 'listTeams' }, { USER: [null] }]) {
      expect(roleDisabledMcpCapabilities(stored, 'USER')).toEqual(everything);
      expect(roleDisabledMcpCapabilities(stored, 'ADMIN')).toEqual([]);
    }
    expect(resolveDisabledMcpCapabilities(everything).has('incident_search')).toBe(true);
    expect(roleDisabledMcpCapabilities(null, 'USER')).toEqual([]);
    expect(roleDisabledMcpCapabilities({ RESPONDER: 'x' }, 'USER')).toEqual([]);
    expect(roleDisabledMcpCapabilities({ toString: ['listTeams'] }, 'USER')).toEqual([]);
    expect(roleDisabledMcpCapabilities({ USER: ['listTeams'] }, '')).toEqual([]);
  });
});
