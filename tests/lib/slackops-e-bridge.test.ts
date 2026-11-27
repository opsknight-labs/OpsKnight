import { describe, expect, it } from 'vitest';
import { buildIncidentCard, type SlackCardIncident } from '@/lib/slack/incident-card';

const base: SlackCardIncident = {
  id: 'i1',
  title: 'T',
  status: 'OPEN',
  urgency: 'HIGH',
  serviceName: 'api',
};
const urls = (incident: SlackCardIncident) => {
  const card = buildIncidentCard(incident, { appUrl: 'https://x.test', interactive: true });
  const actions = card.attachments[0].blocks.find(b => b.type === 'actions') as unknown as {
    elements: Array<{ action_id: string; url?: string; text?: { text: string } }>;
  };
  return actions.elements;
};

describe('card meeting bridge button', () => {
  const meeting = { provider: 'ZOOM', joinUrl: 'https://zoom.us/j/1' };
  it('shows Join <provider> for an open incident', () => {
    const el = urls({ ...base, meeting }).find(e => e.action_id === 'join_bridge');
    expect(el?.url).toBe(meeting.joinUrl);
    expect(el?.text?.text).toBe('Join Zoom');
  });
  it('is absent without a meeting', () => {
    expect(urls(base).some(e => e.action_id === 'join_bridge')).toBe(false);
  });
  it('is absent when resolved', () => {
    expect(
      urls({ ...base, status: 'RESOLVED', meeting }).some(e => e.action_id === 'join_bridge')
    ).toBe(false);
  });
  it('is absent for non-https urls', () => {
    for (const joinUrl of ['http://zoom.us/j/1', 'javascript:alert(1)']) {
      expect(
        urls({ ...base, meeting: { provider: 'ZOOM', joinUrl } }).some(
          e => e.action_id === 'join_bridge'
        )
      ).toBe(false);
    }
  });
  it('never exceeds 25 elements', () => {
    expect(urls({ ...base, meeting }).length).toBeLessThanOrEqual(25);
  });
});
