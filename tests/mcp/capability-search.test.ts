import { describe, expect, it } from 'vitest';
import { searchCapabilities } from '@/lib/mcp/protocol/capability-search';
import { MCP_SEARCH_KEYWORDS } from '@/lib/mcp/protocol/search-keywords';
import { MCP_CATALOG, MCP_OPERATION_MAP } from '@/lib/mcp/catalog';

const catalog = [
  { operationId: 'listServices', tool: null, domain: 'services' },
  { operationId: 'getService', tool: null, domain: 'services' },
  { operationId: 'listTeams', tool: null, domain: 'teams' },
  { operationId: 'listEscalationPolicies', tool: null, domain: 'escalation-policies' },
  { operationId: 'getIncidentTimeline', tool: 'incident_get_timeline', domain: 'incidents' },
  { operationId: 'lookupOncall', tool: 'oncall_lookup', domain: 'schedules' },
];
const ids = (query: string) => searchCapabilities(catalog, query).map(op => op.operationId);
const top = (query: string) => ids(query)[0];

describe('searchCapabilities', () => {
  it('finds operations from natural multi-word queries an assistant sends', () => {
    expect(top('list services')).toBe('listServices');
    expect(top('list all the teams')).toBe('listTeams');
    expect(top('escalation policies')).toBe('listEscalationPolicies');
    expect(top('incident timeline')).toBe('getIncidentTimeline');
    expect(ids('who is oncall')).toEqual(['lookupOncall']);
  });

  it('still matches exact ids, tools, domains and single words', () => {
    expect(top('listServices')).toBe('listServices');
    // The id typed as one lowercase word, as assistants often do.
    expect(top('listteams')).toBe('listTeams');
    expect(top('getincidenttimeline')).toBe('getIncidentTimeline');
    expect(top('incident_get_timeline')).toBe('getIncidentTimeline');
    expect(ids('service')).toEqual(['listServices', 'getService']);
    expect(ids('LIST')).toEqual(['listServices', 'listTeams', 'listEscalationPolicies']);
  });

  it('ranks the operation matching the most words first, and returns nothing when none match', () => {
    expect(ids('list services unknownword')[0]).toBe('listServices');
    // Partial matches follow instead of being dropped, so the next page still has candidates.
    expect(ids('list services unknownword')).toContain('listTeams');
    expect(ids('users')).toEqual([]);
  });

  it('matches whole words only, singular or plural', () => {
    const catalog = [
      {
        operationId: 'reopenIncident',
        domain: 'incidents',
        risk: 'R2',
        status: 'APPROVAL_REQUIRED',
      },
      { operationId: 'listEscalationPolicies', domain: 'escalation-policies' },
      { operationId: 'listIncidents', domain: 'incidents', risk: 'R0', status: 'CURATED' },
    ];
    const found = (query: string) => searchCapabilities(catalog, query).map(op => op.operationId);
    expect(found('reopen')).toEqual(['reopenIncident']);
    // "open" is not a word of reopenIncident; listIncidents has it as a search keyword.
    expect(found('open')).toEqual(['listIncidents']);
    expect(found('policy')).toEqual(['listEscalationPolicies']);
    expect(found('incident')[0]).toBe('listIncidents');
  });

  it('ranks reads before changes and curated before approval-gated on equal scores', () => {
    const catalog = [
      { operationId: 'updateThing', domain: 'things', risk: 'R1', status: 'CURATED' },
      { operationId: 'deleteThing', domain: 'things', risk: 'R2', status: 'APPROVAL_REQUIRED' },
      { operationId: 'getThing', domain: 'things', risk: 'R0', status: 'DISCOVERABLE' },
      { operationId: 'getThingConfig', domain: 'things', risk: 'R2', status: 'SENSITIVE_READ' },
    ];
    expect(searchCapabilities(catalog, 'things').map(op => op.operationId)).toEqual([
      'getThing',
      'getThingConfig',
      'updateThing',
      'deleteThing',
    ]);
  });

  it('treats an empty or filler-only query as everything', () => {
    expect(ids('')).toHaveLength(catalog.length);
    expect(ids('all the')).toHaveLength(catalog.length);
  });

  it('matches contract summaries, ranking a name match above a summary-only match', () => {
    const described = [
      { operationId: 'getScheduleOnCall', domain: 'schedules', summary: 'Effective on-call users' },
      { operationId: 'listUsers', domain: 'users', summary: 'List users' },
      { operationId: 'listTeams', domain: 'teams', summary: 'List teams and their users' },
    ];
    const found = (query: string) => searchCapabilities(described, query).map(op => op.operationId);
    expect(found('effective on-call')).toEqual(['getScheduleOnCall']);
    expect(found('users').slice(0, 2)).toEqual(['listUsers', 'listTeams']);
    expect(found('list users')[0]).toBe('listUsers');
  });
});

describe('golden queries against the real catalog', () => {
  const first = (query: string) => searchCapabilities(MCP_CATALOG, query)[0]?.operationId;
  it.each([
    ['open incidents', 'listIncidents'],
    ['list incidents', 'listIncidents'],
    ['show open incidents', 'listIncidents'],
    ['check SLO', 'listServiceObjectives'],
    ['error budget', 'listServiceObjectives'],
    ['who is on call', 'getScheduleOnCall'],
    ['my shifts', 'getScheduleOnCall'],
    ['run runbook', 'executeRunbook'],
    ['acknowledge incident', 'acknowledgeIncident'],
    ['incident_get_timeline', 'getIncidentTimeline'],
  ])('%s -> %s', (query, expected) => {
    expect(first(query)).toBe(expected);
  });

  it('never ranks an approval-gated change first for a read question', () => {
    const best = searchCapabilities(MCP_CATALOG, 'show open incidents')[0];
    expect(best?.status).not.toBe('APPROVAL_REQUIRED');
  });
});

describe('search keywords', () => {
  it('name only catalog operations', () => {
    for (const operationId of MCP_SEARCH_KEYWORDS.keys())
      expect(MCP_OPERATION_MAP.has(operationId), operationId).toBe(true);
  });
});
