import { describe, expect, it } from 'vitest';
import {
  buildSlackHealthReport,
  computeSlackScopeHealth,
  describeSlackPostError,
  slackDmEligibility,
} from '@/lib/slack/health';
import { buildSlackDmIncidentMessage } from '@/lib/slack/incident-dm-card';
import {
  SLACK_BOT_SCOPES,
  SLACK_OPTIONAL_BOT_SCOPES,
  SLACK_REQUIRED_BOT_SCOPES,
} from '@/lib/slack/app-manifest';

const NOW = new Date('2026-12-02T12:00:00Z');

function report(overrides: Partial<Parameters<typeof buildSlackHealthReport>[0]> = {}) {
  return buildSlackHealthReport({
    auth: { ok: true, team: 'Acme', teamId: 'T1' },
    storedWorkspaceId: 'T1',
    scopes: [...SLACK_BOT_SCOPES],
    signingSecretConfigured: true,
    lastInboundAt: new Date(NOW.getTime() - 5 * 60_000),
    squireChatEnabled: true,
    now: NOW,
    ...overrides,
  });
}

describe('computeSlackScopeHealth', () => {
  it('is healthy only when every manifest scope is granted', () => {
    expect(computeSlackScopeHealth([...SLACK_BOT_SCOPES]).healthy).toBe(true);
    expect(computeSlackScopeHealth([...SLACK_BOT_SCOPES]).manifestOutdated).toBe(false);
  });

  it('is not healthy when only optional Squire scopes are missing (the staging case)', () => {
    // Staging showed "Scopes healthy, all 13 granted" with exactly these two missing.
    const granted = SLACK_BOT_SCOPES.filter(
      scope => scope !== 'app_mentions:read' && scope !== 'chat:write.customize'
    );
    const health = computeSlackScopeHealth(granted);
    expect(health.healthy).toBe(false);
    expect(health.missingRequired).toEqual([]);
    expect(health.manifestOutdated).toBe(true);
    expect(health.missingOptional.map(item => item.scope)).toEqual([
      'app_mentions:read',
      'chat:write.customize',
    ]);
    expect(health.missingOptional[0].enables).toMatch(/Squire/);
  });

  it('describes what every optional scope enables', () => {
    const health = computeSlackScopeHealth([...SLACK_REQUIRED_BOT_SCOPES]);
    expect(health.missingOptional).toHaveLength(SLACK_OPTIONAL_BOT_SCOPES.length);
    for (const item of health.missingOptional) expect(item.enables.length).toBeGreaterThan(5);
  });
});

describe('slackDmEligibility', () => {
  it('needs im:write and users:read.email', () => {
    expect(slackDmEligibility([...SLACK_BOT_SCOPES])).toEqual({ eligible: true, reason: null });
    const old = slackDmEligibility([...SLACK_REQUIRED_BOT_SCOPES]);
    expect(old.eligible).toBe(false);
    expect(old.reason).toContain('im:write');
    expect(old.reason).not.toContain('users:read.email');
  });

  it('explains when Slack is not connected', () => {
    expect(slackDmEligibility([])).toEqual({ eligible: false, reason: 'Slack is not connected.' });
    expect(slackDmEligibility(null).eligible).toBe(false);
  });
});

describe('buildSlackHealthReport', () => {
  it('passes when everything is in place', () => {
    const r = report();
    expect(r.overall).toBe('ok');
    expect(r.checks.every(check => check.status === 'ok')).toBe(true);
    expect(r.dm.eligible).toBe(true);
  });

  it('fails on a revoked token with an actionable message', () => {
    const r = report({ auth: { ok: false, error: 'token_revoked' } });
    expect(r.overall).toBe('error');
    expect(r.checks.find(c => c.id === 'connection')?.detail).toMatch(/Reconnect/);
    expect(r.checks.some(c => c.id === 'workspace')).toBe(false);
  });

  it('warns about missing feature scopes without failing', () => {
    const r = report({ scopes: [...SLACK_REQUIRED_BOT_SCOPES] });
    expect(r.overall).toBe('warn');
    expect(r.checks.find(c => c.id === 'required_scopes')?.status).toBe('ok');
    expect(r.checks.find(c => c.id === 'optional_scopes')?.detail).toContain('im:write');
    // Squire is on but cannot hear mentions.
    expect(r.checks.find(c => c.id === 'squire_chat')?.status).toBe('warn');
  });

  it('errors on missing required scopes or signing secret', () => {
    expect(report({ scopes: ['chat:write'] }).checks.find(c => c.id === 'required_scopes')?.status).toBe('error');
    expect(report({ signingSecretConfigured: false }).overall).toBe('error');
  });

  it('flags a token from a different workspace', () => {
    const r = report({ auth: { ok: true, team: 'Other', teamId: 'T2' } });
    expect(r.checks.find(c => c.id === 'workspace')?.status).toBe('warn');
  });

  it('reports the last inbound request and the events to subscribe when none arrived', () => {
    expect(report().checks.find(c => c.id === 'inbound')?.detail).toContain('5 min ago');
    const none = report({ lastInboundAt: null }).checks.find(c => c.id === 'inbound');
    expect(none?.status).toBe('warn');
    expect(none?.detail).toContain('app_mention');
  });
});

describe('describeSlackPostError', () => {
  it('turns not_in_channel into an invite instruction for that channel', () => {
    expect(describeSlackPostError('not_in_channel', 'ops-alerts')).toBe(
      'Invite @OpsKnight to #ops-alerts (type /invite @OpsKnight in the channel), then try again.'
    );
  });

  it('covers archived, missing and unknown errors', () => {
    expect(describeSlackPostError('is_archived', '#old')).toContain('#old is archived');
    expect(describeSlackPostError('channel_not_found')).toContain('the channel');
    expect(describeSlackPostError('weird_thing')).toContain('weird thing');
    expect(describeSlackPostError(undefined)).toBe('Slack refused the message.');
  });
});

describe('buildSlackDmIncidentMessage', () => {
  const incident = {
    id: 'inc_1',
    title: 'DB <down> & *on fire*',
    serviceName: 'Payments <core>',
    status: 'OPEN',
    urgency: 'HIGH',
    priority: 'P1',
    createdAt: NOW,
    assigneeName: null,
    url: 'https://ok.example.com/incidents/inc_1',
  };

  it('escapes user text and reuses the channel card action ids', () => {
    const { text, blocks } = buildSlackDmIncidentMessage(incident, 'triggered');
    const section = JSON.stringify(blocks[0]);
    expect(section).toContain('DB &lt;down&gt; &amp;');
    expect(section).not.toContain('<down>');
    expect(section).toContain('Payments &lt;core&gt;');
    // Slack parses the push fallback as mrkdwn too, so it is escaped as well.
    expect(text).toContain('DB &lt;down&gt;');
    expect(text).not.toContain('<down>');
    const actions = blocks.find(block => block.type === 'actions') as {
      elements: Array<{ action_id: string; value?: string; confirm?: unknown }>;
    };
    expect(actions.elements.map(e => e.action_id)).toEqual([
      'ack_incident',
      'resolve_incident',
      'open_incident',
    ]);
    expect(JSON.parse(actions.elements[0].value!)).toEqual({ action: 'ack', incidentId: 'inc_1' });
    expect(actions.elements[1].confirm).toBeDefined();
  });

  it('drops Ack once acknowledged and all actions once resolved', () => {
    const acked = buildSlackDmIncidentMessage({ ...incident, status: 'ACKNOWLEDGED' }, 'acknowledged');
    const ackIds = (acked.blocks.at(-1) as { elements: Array<{ action_id: string }> }).elements.map(
      e => e.action_id
    );
    expect(ackIds).toEqual(['resolve_incident', 'open_incident']);
    const resolved = buildSlackDmIncidentMessage({ ...incident, status: 'RESOLVED' }, 'resolved');
    const resolvedIds = (
      resolved.blocks.at(-1) as { elements: Array<{ action_id: string }> }
    ).elements.map(e => e.action_id);
    expect(resolvedIds).toEqual(['open_incident']);
  });
});
