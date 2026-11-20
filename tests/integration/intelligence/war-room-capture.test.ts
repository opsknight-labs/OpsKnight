import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { getIncidentTimeAxisForActor } from '@/lib/intelligence/timeline/service';
import { toIntelligenceTimelineEvents } from '@/lib/intelligence/incident-ux/timeline-overlay';
import {
  CAPTURE_LIMITS,
  captureSlackChannelMessage,
  clipBytes,
  resetCaptureSwitchCache,
} from '@/lib/chatops/war-room-capture';
import {
  LIFECYCLE_EVENT_WHERE,
  loadPostmortemEvents,
  POSTMORTEM_CHAT_MAX,
} from '@/lib/incidents/event-filters';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const WORKSPACE = 'T_WS';
const CHANNEL = 'C_ROOM';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  resetCaptureSwitchCache();
});

async function world(options: { capture?: boolean; visibility?: 'PUBLIC' | 'PRIVATE' } = {}) {
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      warRoomCaptureEnabled: options.capture ?? true,
    },
  });
  const service = await createTestService('Checkout');
  const incident = await createTestIncident('Checkout errors', service.id, {
    slackChannelId: CHANNEL,
    slackWorkspaceId: WORKSPACE,
    visibility: options.visibility ?? 'PUBLIC',
  });
  return { service, incident };
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  team_id: WORKSPACE,
  event: {
    type: 'message',
    channel: CHANNEL,
    channel_type: 'channel',
    user: 'U1',
    text,
    ts: `${Math.floor(Date.now() / 1000)}.000100`,
    ...extra,
  },
});

const chatRows = (incidentId: string) =>
  db.incidentEvent.findMany({ where: { incidentId, type: 'CHAT_MESSAGE' } });

describe('war-room channel capture', () => {
  it('saves nothing while the switch is off (the default), reading the switch once per TTL', async () => {
    const w = await world({ capture: false });
    expect(await captureSlackChannelMessage(message('rolling back now'))).toBe('DISABLED');
    expect(await chatRows(w.incident.id)).toHaveLength(0);
    // Turned on in the database, but the cached "off" holds until the TTL passes.
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { warRoomCaptureEnabled: true },
    });
    expect(await captureSlackChannelMessage(message('second message'))).toBe('DISABLED');
    resetCaptureSwitchCache();
    expect(await captureSlackChannelMessage(message('third message'))).toBe('CAPTURED');
  });

  it('saves a person message as a timeline entry, with secrets redacted', async () => {
    const w = await world();
    expect(
      await captureSlackChannelMessage(message('rolling back, key AKIAIOSFODNN7EXAMPLE'))
    ).toBe('CAPTURED');
    const [row] = await chatRows(w.incident.id);
    expect(row.message).toContain('Slack user U1: rolling back');
    expect(row.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('ignores bot posts, edits and other channels', async () => {
    const w = await world();
    expect(await captureSlackChannelMessage(message('x', { bot_id: 'B1' }))).toBe(
      'NOT_A_PERSON_MESSAGE'
    );
    expect(await captureSlackChannelMessage(message('x', { subtype: 'message_changed' }))).toBe(
      'NOT_A_PERSON_MESSAGE'
    );
    expect(await captureSlackChannelMessage(message('x', { channel: 'C_OTHER' }))).toBe(
      'NOT_A_WAR_ROOM'
    );
    expect(await captureSlackChannelMessage(message('x', { channel_type: 'im' }))).toBe(
      'NOT_A_WAR_ROOM'
    );
    expect(await chatRows(w.incident.id)).toHaveLength(0);
  });

  it('captures private and public war-room channels regardless of incident visibility', async () => {
    const w = await world();
    // Visibility is a status-page setting only; it never gates war-room capture.
    expect(
      await captureSlackChannelMessage(message('from a private room', { channel_type: 'group' }))
    ).toBe('CAPTURED');
    expect(await captureSlackChannelMessage(message('from a public room'))).toBe('CAPTURED');
    expect(await chatRows(w.incident.id)).toHaveLength(2);
  });

  it('stops at the per-incident cap and clips long messages to the byte budget', async () => {
    const w = await world();
    await db.incidentEvent.createMany({
      data: Array.from({ length: CAPTURE_LIMITS.perIncident }, () => ({
        incidentId: w.incident.id,
        type: 'CHAT_MESSAGE' as const,
        message: 'earlier',
      })),
    });
    expect(await captureSlackChannelMessage(message('one more'))).toBe('LIMIT_REACHED');
    const clipped = clipBytes('é'.repeat(5_000), CAPTURE_LIMITS.messageBytes);
    expect(Buffer.byteLength(clipped)).toBeLessThanOrEqual(CAPTURE_LIMITS.messageBytes);
  });

  it('shows saved messages on the intelligence time axis, but not twice on the core timeline', async () => {
    const w = await world();
    await captureSlackChannelMessage(message('db failover started'));
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = await resolveUserActor(admin.id);
    const axis = await getIncidentTimeAxisForActor(w.incident.id, actor!);
    expect(axis!.entries.find(entry => entry.kind === 'CHAT')?.title).toContain(
      'db failover started'
    );
    expect(toIntelligenceTimelineEvents(axis).some(row => (row.kind as string) === 'CHAT')).toBe(
      false
    );
  });

  it('keeps captured chat out of lifecycle reads and bounds it in postmortems', async () => {
    const w = await world();
    const at = (i: number) => new Date(Date.UTC(2026, 10, 17, 10, i));
    await db.incidentEvent.createMany({
      data: [
        {
          incidentId: w.incident.id,
          message: 'Acknowledged',
          type: 'ACKNOWLEDGED',
          createdAt: at(0),
        },
        { incidentId: w.incident.id, message: 'Untyped', createdAt: at(1) },
        ...Array.from({ length: POSTMORTEM_CHAT_MAX + 5 }, (_, i) => ({
          incidentId: w.incident.id,
          message: `Slack user U1: step ${i}`,
          type: 'CHAT_MESSAGE' as const,
          createdAt: at(2 + i),
        })),
      ],
    });

    const lifecycle = await db.incidentEvent.findMany({
      where: { incidentId: w.incident.id, ...LIFECYCLE_EVENT_WHERE },
      select: { message: true },
    });
    expect(lifecycle.map(e => e.message).sort()).toEqual(['Acknowledged', 'Untyped']);

    const events = await loadPostmortemEvents(db, w.incident.id);
    expect(events.filter(e => e.type === 'CHAT_MESSAGE')).toHaveLength(POSTMORTEM_CHAT_MAX);
    expect(events.filter(e => e.type !== 'CHAT_MESSAGE')).toHaveLength(2);
    expect(events.some(e => e.message.endsWith('step 0'))).toBe(true);
  });
});
