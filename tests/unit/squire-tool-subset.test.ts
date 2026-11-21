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
  read('get_automation_decision'),
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
const always = ['get_incident', 'get_timeline'];
const core = [
  'propose_acknowledge_incident',
  'propose_resolve_incident',
  'propose_add_incident_note',
];
const proposals = ALL.filter(tool => tool.kind === 'PROPOSE_WRITE').map(tool => tool.name);

describe('tool subset by intent', () => {
  it.each([
    ['Why is checkout failing?', ['query_metrics', 'get_automation_decision']],
    ['Summarise this incident', ['query_metrics']],
    ['What happened on the timeline?', []],
    ['Who is on call for this?', []],
  ])(
    'a question (%s) gets the small reads, the families it asks for and the core proposals',
    (q, extra) => {
      expect(offered(q)).toEqual(
        ALL.map(tool => tool.name).filter(
          name => always.includes(name) || extra.includes(name) || core.includes(name)
        )
      );
    }
  );

  it.each([
    ['Start the postmortem', []],
    ['We rolled back; resolve it', []],
    ['Link this to last week’s incident', []],
    ['/ack', []],
    ['Check the metrics and add a note', ['query_metrics']],
  ])('an action (%s) gets every proposal and only the read families it asks for', (q, extra) => {
    expect(offered(q)).toEqual(
      ALL.map(tool => tool.name).filter(
        name => always.includes(name) || extra.includes(name) || proposals.includes(name)
      )
    );
  });

  it('falls back to the full set when the intent is unknown', () => {
    expect(offered('What can you look up?')).toEqual(ALL.map(tool => tool.name));
    expect(offered('probe')).toEqual(ALL.map(tool => tool.name));
  });
});
