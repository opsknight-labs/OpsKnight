import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chatOpsConfig: vi.fn(),
  incident: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    chatOpsConfig: { findUnique: h.chatOpsConfig },
    incident: { findUnique: h.incident },
  },
}));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn(), getSlackBotScopes: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  classifySlackHttpFailure,
  parseSlackRetryAfter,
  slackApiCall,
} from '@/lib/war-room/providers/slack/client';
import { renderSlackWarRoomProjection } from '@/lib/war-room/providers/slack/render';
import {
  buildSlackWarRoomWelcomeBlocks,
  slackWarRoomChannelName,
} from '@/lib/war-room/providers/slack/provision';
import { slackArchiveDelay } from '@/lib/war-room/providers/slack/adapter';
import { buildWarRoomProjection } from '@/lib/war-room/projection-model';

afterEach(() => vi.unstubAllGlobals());

describe('Slack war-room client: 429 classification', () => {
  it('treats HTTP 429 as definitely-not-applied and retryable with Retry-After', () => {
    const result = classifySlackHttpFailure('conversations.create', 429, '', '12');
    expect(result).toMatchObject({
      ok: false,
      rateLimited: true,
      sideEffectAmbiguous: false,
      retryAfterMs: 12_000,
    });
  });

  it('treats a `ratelimited` body as rate-limited even without a 429 status', () => {
    const result = classifySlackHttpFailure(
      'chat.postMessage',
      503,
      '{"ok":false,"error":"ratelimited"}',
      null
    );
    expect(result.rateLimited).toBe(true);
    expect(result.sideEffectAmbiguous).toBe(false);
  });

  it('keeps 5xx side-effect-ambiguous for non-idempotent creates only', () => {
    expect(classifySlackHttpFailure('conversations.create', 502, '', null)).toMatchObject({
      sideEffectAmbiguous: true,
      transportFailure: true,
    });
    expect(classifySlackHttpFailure('conversations.info', 502, '', null).sideEffectAmbiguous).toBe(
      false
    );
  });

  it('bounds Retry-After', () => {
    expect(parseSlackRetryAfter(null)).toBe(30_000);
    expect(parseSlackRetryAfter('0')).toBe(30_000);
    expect(parseSlackRetryAfter('99999')).toBe(15 * 60_000);
  });

  it('marks an HTTP 200 `ratelimited` reply as rate-limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Retry-After': '3' }),
        json: async () => ({ ok: false, error: 'ratelimited' }),
      })
    );
    const result = await slackApiCall('chat.postMessage', 'xoxb', { channel: 'C1' });
    expect(result).toMatchObject({
      rateLimited: true,
      sideEffectAmbiguous: false,
      retryAfterMs: 3000,
    });
  });
});

const incident = {
  id: 'cmabcdef123456',
  title: 'DB <!channel> & *latency*',
  status: 'OPEN',
  urgency: 'HIGH',
  priority: 'P1',
  serviceName: 'Pay<ments>',
  url: 'https://ops.example.com/incidents/cmabcdef123456',
  createdAt: new Date('2026-09-14T00:00:00Z'),
  assigneeName: 'Ada <x>',
};

describe('Slack war-room status card', () => {
  it('escapes incident text and shows friendly labels, header and opened time', () => {
    const card = renderSlackWarRoomProjection(buildWarRoomProjection(incident));
    const json = JSON.stringify(card.blocks);
    expect(card.blocks[0]).toMatchObject({ type: 'header' });
    expect(json).not.toContain('<!channel>');
    expect(json).toContain('&lt;!channel&gt;');
    expect(json).toContain('Pay&lt;ments&gt;');
    expect(json).toContain('*Status:* Triggered');
    expect(json).toContain('*Urgency:* High');
    expect(json).toContain(`<!date^${Date.parse('2026-09-14T00:00:00Z') / 1000}^{ago}|`);
    expect(card.text).not.toContain('<!channel>');
  });

  it('has Ack, Escalate (with confirm) and View buttons, and Resolve with confirm once acknowledged', () => {
    const triggered = renderSlackWarRoomProjection(buildWarRoomProjection(incident));
    const actions = triggered.blocks.at(-1) as {
      type: string;
      elements: Array<Record<string, unknown>>;
    };
    expect(actions.type).toBe('actions');
    const ids = actions.elements.map(e => e.action_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'ack_incident',
        'take_command_incident',
        'escalate_incident',
        'view_incident',
      ])
    );
    expect(actions.elements.find(e => e.action_id === 'escalate_incident')).toHaveProperty(
      'confirm'
    );
    expect(actions.elements.find(e => e.action_id === 'view_incident')).toMatchObject({
      url: incident.url,
    });

    const acked = renderSlackWarRoomProjection(
      buildWarRoomProjection({ ...incident, status: 'ACKNOWLEDGED', acknowledgedAt: new Date() })
    );
    const ackedActions = acked.blocks.at(-1) as { elements: Array<Record<string, unknown>> };
    expect(ackedActions.elements.find(e => e.action_id === 'resolve_incident')).toHaveProperty(
      'confirm'
    );
  });

  it('mentions the assignee and commander when their Slack ids are known', () => {
    const model = buildWarRoomProjection({
      ...incident,
      roles: [
        { roleKey: 'COMMANDER', label: 'Incident commander', shortLabel: 'Commander', name: 'Bo' },
      ],
    });
    const json = JSON.stringify(
      renderSlackWarRoomProjection(model, { assignee: 'U123ABC', commander: 'W999XYZ' }).blocks
    );
    expect(json).toContain('*Assignee:* <@U123ABC>');
    expect(json).toContain('*Commander:* <@W999XYZ>');
    // Unknown or malformed ids fall back to the escaped name.
    const fallback = JSON.stringify(
      renderSlackWarRoomProjection(model, { assignee: '<!here>' }).blocks
    );
    expect(fallback).toContain('*Assignee:* Ada &lt;x&gt;');
  });

  it('offers Escalate only while the incident is open, since escalation refuses anything else', () => {
    const ids = (status: string) =>
      (
        renderSlackWarRoomProjection(buildWarRoomProjection({ ...incident, status })).blocks.find(
          block => block.type === 'actions'
        ) as { elements: Array<Record<string, unknown>> }
      ).elements.map(e => e.action_id);
    expect(ids('OPEN')).toContain('escalate_incident');
    expect(ids('SNOOZED')).not.toContain('escalate_incident');
    expect(ids('ACKNOWLEDGED')).not.toContain('escalate_incident');
  });

  it('has no buttons once resolved', () => {
    const card = renderSlackWarRoomProjection(
      buildWarRoomProjection({ ...incident, status: 'RESOLVED', resolvedAt: new Date() })
    );
    expect(card.blocks.some(block => block.type === 'actions')).toBe(false);
    expect(card.blocks[0]).toMatchObject({ text: { text: expect.stringMatching(/^✅/) } });
  });
});

describe('Slack war-room channel names and welcome', () => {
  it('builds a readable name from the short id and title within 80 characters', () => {
    const name = slackWarRoomChannelName({ channelPrefix: 'inc' }, incident);
    expect(name).toBe('inc-123456-db-channel-latency');
    expect(slackWarRoomChannelName({ channelPrefix: '#Ops War' }, incident, 2)).toBe(
      'ops-war-123456-db-channel-latency-g2'
    );
    const long = slackWarRoomChannelName({}, { id: 'abc123456', title: 'x'.repeat(200) }, 3);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('-g3')).toBe(true);
    expect(long).toMatch(/^[a-z0-9_-]+$/);
    expect(slackWarRoomChannelName({}, { id: 'abc123456', title: '🔥🔥' })).toBe('inc-123456');
  });

  it('keeps the welcome short, escaped and pointing at the card below', () => {
    const blocks = buildSlackWarRoomWelcomeBlocks({
      title: '<!everyone> outage',
      serviceName: 'Pay',
      commanderName: null,
      incidentUrl: 'https://ops.example.com/incidents/1',
    });
    const json = JSON.stringify(blocks);
    expect(json).not.toContain('<!everyone>');
    expect(json).toContain('below');
    expect(json).not.toContain('above');
    expect(json).toContain('@Squire');
    expect(json).toContain('/incident ack');
  });
});

describe('delayed war-room archive', () => {
  it('archives at once when no delay is configured (today’s behaviour)', async () => {
    h.chatOpsConfig.mockResolvedValue({ warRoomArchiveDelayHours: null });
    await expect(slackArchiveDelay('inc-1')).resolves.toBe(0);
  });

  it('waits until resolvedAt + delay, and skips when the incident was reopened', async () => {
    h.chatOpsConfig.mockResolvedValue({ warRoomArchiveDelayHours: 2 });
    h.incident.mockResolvedValue({
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 3_600_000),
    });
    const wait = await slackArchiveDelay('inc-1');
    expect(typeof wait).toBe('number');
    expect(wait as number).toBeGreaterThan(3_500_000);
    expect(wait as number).toBeLessThanOrEqual(3_600_000);
    h.incident.mockResolvedValue({ status: 'OPEN', resolvedAt: null });
    await expect(slackArchiveDelay('inc-1')).resolves.toBe('SKIP');
  });
});
