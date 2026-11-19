import { describe, expect, it } from 'vitest';
import type { AiToolDefinition } from '@/lib/intelligence/ai/port';
import { toolsForMessage } from '@/lib/intelligence/squire/tools';

const read = (name: string): AiToolDefinition => ({
  name,
  description: name,
  kind: 'READ',
  inputSchema: {},
});
const propose = (name: string): AiToolDefinition => ({
  name: `propose_${name}`,
  description: name,
  kind: 'PROPOSE_WRITE',
  inputSchema: {},
});
const ALL = [
  read('get_incident'),
  read('get_timeline'),
  read('query_metrics'),
  propose('acknowledge_incident'),
  propose('resolve_incident'),
  propose('add_incident_note'),
  propose('draft_postmortem'),
  propose('link_related_incident'),
  propose('draft_status_update'),
  propose('draft_automation_rule'),
];
const offered = (message: string, onIncident = true) =>
  toolsForMessage(ALL, message, onIncident).map(tool => tool.name);
const reads = ['get_incident', 'get_timeline', 'query_metrics'];
const core = [
  'propose_acknowledge_incident',
  'propose_resolve_incident',
  'propose_add_incident_note',
];

describe('tool subset by intent', () => {
  it.each([
    'Why is checkout failing?',
    'What happened on the timeline?',
    'Who is on call for this?',
    'Summarise this incident',
  ])('a question (%s) gets every read tool and only the core incident proposals', question => {
    expect(offered(question)).toEqual([...reads, ...core]);
  });

  it.each([
    'Start the postmortem',
    'We rolled back; resolve it',
    'Draft a status update for customers',
    'Link this to last week’s incident',
    '/ack',
  ])('an action (%s) gets the full set', question => {
    expect(offered(question)).toEqual(ALL.map(tool => tool.name));
  });

  it('falls back to the full set when the intent is unknown', () => {
    expect(offered('What can you look up?')).toEqual(ALL.map(tool => tool.name));
    expect(offered('probe')).toEqual(ALL.map(tool => tool.name));
  });
});
