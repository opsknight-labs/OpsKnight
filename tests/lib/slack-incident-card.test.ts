import { describe, expect, it } from 'vitest';
import {
  buildIncidentCard,
  buildThreadReply,
  cardActionElements,
  cardStateFromStatus,
  formatDuration,
  isOpsKnightIncidentCard,
  urgencyLabel,
  type SlackBlock,
  type SlackCardIncident,
} from '@/lib/slack/incident-card';

const base: SlackCardIncident = {
  id: 'inc-1',
  title: 'Checkout latency',
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'p1',
  serviceName: 'payments',
  createdAt: new Date('2026-11-01T10:00:00Z'),
};

const blocksOf = (incident: SlackCardIncident, interactive = true) =>
  buildIncidentCard(incident, { appUrl: 'https://ops.example.com', interactive }).attachments[0]
    .blocks;
const actionIds = (blocks: SlackBlock[]) =>
  ((blocks.find(b => b.type === 'actions')?.elements as SlackBlock[]) ?? []).map(e => e.action_id);

describe('Slack incident card', () => {
  it('renders header, friendly labels, local time and an informative fallback', () => {
    const card = buildIncidentCard(base, { appUrl: 'https://ops.example.com', interactive: true });
    // The header is a top-level block, so Slack hides `text` rather than showing the title twice.
    const [header] = card.blocks as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const [context] = card.attachments[0].blocks as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(header.text.text).toBe('🔴 [P1] Checkout latency');
    expect(context.elements[0].text).toContain('*Triggered*');
    expect(context.elements[0].text).toContain('High urgency');
    expect(context.elements[0].text).toMatch(/<!date\^\d+\^\{date_short_pretty\} at \{time\}\|/);
    expect(card.text).toBe('🔴 [P1] Triggered · payments — Checkout latency');
    expect(card.attachments[0].color).toBe('#d32f2f');
  });

  it('escapes alert-supplied text so it cannot ping the channel or inject links', () => {
    const card = buildIncidentCard(
      {
        ...base,
        title: '<!channel> down',
        description: 'see <https://evil.example|here> & <@U123>',
        serviceName: '<!here>',
        assigneeName: '<!everyone>',
      },
      { appUrl: 'https://ops.example.com', interactive: true, note: '<!subteam^S1> note' }
    );
    const json = JSON.stringify({ text: card.text, blocks: card.attachments[0].blocks });
    expect(json).not.toMatch(/<!(channel|here|everyone|subteam)/);
    expect(json).not.toContain('<https://evil');
    expect(json).not.toContain('<@U123>');
    expect(json).toContain('&lt;!channel&gt;');
  });

  it('mentions the assignee when the Slack user is known and degrades to the name', () => {
    const mention = JSON.stringify(
      blocksOf({ ...base, assigneeName: 'Ana', assigneeSlackId: 'U42' })
    );
    expect(mention).toContain('<@U42>');
    const name = JSON.stringify(blocksOf({ ...base, assigneeName: 'Ana', assigneeSlackId: null }));
    expect(name).toContain('Ana');
    expect(name).not.toContain('<@');
    expect(JSON.stringify(blocksOf(base))).toContain('_Unassigned_');
  });

  it('shows the escalation level once escalated past level 1', () => {
    // escalationStep is the step that runs next: 2 means levels 1 and 2 have paged.
    const json = JSON.stringify(blocksOf({ ...base, escalationStep: 2 }));
    expect(json).toContain('Escalated to level 2');
    expect(json).toContain('Level 2');
    expect(JSON.stringify(blocksOf({ ...base, escalationStep: 1 }))).not.toMatch(
      /Escalated to level|\*Escalation\*/
    );
    expect(JSON.stringify(blocksOf(base))).not.toContain('Escalated to level');
  });

  it('offers only the buttons that still apply', () => {
    expect(actionIds(blocksOf(base))).toEqual([
      'ack_incident',
      'resolve_incident',
      'snooze_incident',
      'escalate_incident',
      'assign_me_incident',
      'incident_more_actions',
      'view_incident',
    ]);
    expect(actionIds(blocksOf({ ...base, status: 'ACKNOWLEDGED' }))).toEqual([
      'resolve_incident',
      'snooze_incident',
      'assign_me_incident',
      'incident_more_actions',
      'view_incident',
    ]);
    expect(actionIds(blocksOf({ ...base, status: 'RESOLVED' }))).toEqual(['view_incident']);
    expect(actionIds(blocksOf(base, false))).toEqual(['view_incident']);
  });

  it('asks for confirmation before resolve and escalate, and snooze carries its duration', () => {
    const elements = cardActionElements('inc-1', 'triggered', 'https://x/incidents/inc-1');
    const byId = new Map(elements.map(e => [e.action_id, e as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(byId.get('resolve_incident')?.confirm).toBeDefined();
    expect(byId.get('escalate_incident')?.confirm.style).toBe('danger');
    const options = byId.get('snooze_incident')?.options as Array<{ value: string }>;
    expect(options.map(o => JSON.parse(o.value).minutes)).toEqual([15, 60, 240]);
    expect(JSON.parse(options[0].value)).toMatchObject({ action: 'snooze', incidentId: 'inc-1' });
    for (const option of options) expect(option.value.length).toBeLessThanOrEqual(150);
  });

  it('maps statuses and labels without leaking raw enums', () => {
    expect(cardStateFromStatus('OPEN')).toBe('triggered');
    expect(cardStateFromStatus('SNOOZED')).toBe('snoozed');
    expect(cardStateFromStatus('weird', 'acknowledged')).toBe('acknowledged');
    expect(urgencyLabel('LOW')).toBe('Low urgency');
    expect(formatDuration(30_000)).toBe('<1m');
    expect(formatDuration(23 * 60_000)).toBe('23m');
    expect(formatDuration(72 * 60_000)).toBe('1h 12m');
    expect(formatDuration(51 * 3_600_000)).toBe('2d 3h');
  });

  it('writes short thread replies and stays silent for plain updates', () => {
    const resolved = {
      ...base,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-11-01T10:23:00Z'),
    };
    expect(buildThreadReply('resolved', resolved, { actor: '<@U1>' })).toBe(
      '✅ Resolved by <@U1> · 23m'
    );
    expect(buildThreadReply('escalated', { ...base, escalationStep: 3 })).toBe(
      '⚡ Escalated to level 3'
    );
    expect(buildThreadReply('reassigned', { ...base, assigneeSlackId: 'U9' })).toBe(
      '👤 Assigned to <@U9>'
    );
    expect(buildThreadReply('updated', base)).toBeNull();
  });

  it('recognises only its own cards for in-place replacement', () => {
    const card = buildIncidentCard(base, { appUrl: 'https://x', interactive: true });
    expect(isOpsKnightIncidentCard({ blocks: card.blocks, attachments: card.attachments })).toBe(
      true
    );
    expect(isOpsKnightIncidentCard({ blocks: [{ type: 'header', block_id: 'war_room' }] })).toBe(
      false
    );
    expect(isOpsKnightIncidentCard(undefined)).toBe(false);
  });
});
