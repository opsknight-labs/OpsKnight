import { describe, expect, it } from 'vitest';
import { searchCapabilities } from '@/lib/mcp/protocol/capability-search';

const catalog = [
  { operationId: 'listServices', tool: null, domain: 'services' },
  { operationId: 'getService', tool: null, domain: 'services' },
  { operationId: 'listTeams', tool: null, domain: 'teams' },
  { operationId: 'listEscalationPolicies', tool: null, domain: 'escalation-policies' },
  { operationId: 'getIncidentTimeline', tool: 'incident_get_timeline', domain: 'incidents' },
  { operationId: 'lookupOncall', tool: 'oncall_lookup', domain: 'schedules' },
];
const ids = (query: string) => searchCapabilities(catalog, query).map(op => op.operationId);

describe('searchCapabilities', () => {
  it('finds operations from natural multi-word queries an assistant sends', () => {
    expect(ids('list services')).toEqual(['listServices']);
    expect(ids('list all the teams')).toEqual(['listTeams']);
    expect(ids('escalation policies')).toEqual(['listEscalationPolicies']);
    expect(ids('incident timeline')).toEqual(['getIncidentTimeline']);
    expect(ids('who is oncall')).toEqual(['lookupOncall']);
  });

  it('still matches exact ids, tools, domains and single words', () => {
    expect(ids('listServices')).toEqual(['listServices']);
    expect(ids('incident_get_timeline')).toEqual(['getIncidentTimeline']);
    expect(ids('service')).toEqual(['listServices', 'getService']);
    expect(ids('LIST')).toEqual(['listServices', 'listTeams', 'listEscalationPolicies']);
  });

  it('returns the operations matching the most words, and nothing when no word matches', () => {
    expect(ids('list services unknownword')).toEqual(['listServices']);
    expect(ids('users')).toEqual([]);
  });

  it('treats an empty or filler-only query as everything', () => {
    expect(ids('')).toHaveLength(catalog.length);
    expect(ids('all the')).toHaveLength(catalog.length);
  });
});
