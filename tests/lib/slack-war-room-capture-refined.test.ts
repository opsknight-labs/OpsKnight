import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  incidentEvent: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
const h = vi.hoisted(() => ({ settings: vi.fn(), find: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/intelligence/settings/service', () => ({ getIntelligenceSettings: h.settings }));
vi.mock('@/lib/chatops/squire/slack', () => ({ findSlackIncidentForChannel: h.find }));

import {
  captureSlackChannelMessage,
  resetCaptureSwitchCache,
} from '@/lib/chatops/war-room-capture';

const client = db as never;
const base = { channel: 'C1', channel_type: 'channel', user: 'U1' };
const msg = (extra: Record<string, unknown>) => ({
  team_id: 'T1',
  event: { type: 'message', ...base, ...extra },
});

beforeEach(() => {
  vi.resetAllMocks();
  resetCaptureSwitchCache();
  h.settings.mockResolvedValue({ enabled: true, warRoomCaptureEnabled: true });
  h.find.mockResolvedValue({ id: 'inc-1' });
  db.incidentEvent.count.mockResolvedValue(0);
});

describe('war-room capture refinement', () => {
  it('captures a normal message', async () => {
    expect(
      await captureSlackChannelMessage(msg({ text: 'rolling back', ts: '100.1' }), client)
    ).toBe('CAPTURED');
    expect(db.incidentEvent.create).toHaveBeenCalledTimes(1);
  });

  it('skips bots, noisy subtypes and very short messages', async () => {
    for (const extra of [
      { text: 'hello there', ts: '1.1', bot_id: 'B1' },
      { text: 'joined', ts: '1.1', subtype: 'channel_join' },
      { text: 'file', ts: '1.1', subtype: 'file_share' },
      { text: 'ok', ts: '1.1' },
      { text: '   ', ts: '1.1' },
    ]) {
      expect(await captureSlackChannelMessage(msg(extra), client)).toBe('NOT_A_PERSON_MESSAGE');
    }
    expect(db.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('message_changed updates the captured entry instead of adding one', async () => {
    db.incidentEvent.updateMany.mockResolvedValue({ count: 1 });
    const out = await captureSlackChannelMessage(
      msg({
        subtype: 'message_changed',
        ts: '200.1',
        message: { user: 'U1', text: 'fixed typo here', ts: '100.1' },
      }),
      client
    );
    expect(out).toBe('UPDATED');
    expect(db.incidentEvent.create).not.toHaveBeenCalled();
    expect(db.incidentEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ incidentId: 'inc-1', createdAt: new Date(100_100) }),
        data: { message: 'Slack user U1: fixed typo here' },
      })
    );
  });

  it('an edit of an uncaptured message adds nothing; a bot edit is ignored', async () => {
    db.incidentEvent.updateMany.mockResolvedValue({ count: 0 });
    const edit = (inner: Record<string, unknown>) =>
      msg({
        subtype: 'message_changed',
        message: { user: 'U1', text: 'edited text', ts: '100.1', ...inner },
      });
    expect(await captureSlackChannelMessage(edit({}), client)).toBe('NOT_A_PERSON_MESSAGE');
    expect(await captureSlackChannelMessage(edit({ bot_id: 'B1' }), client)).toBe(
      'NOT_A_PERSON_MESSAGE'
    );
    expect(db.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('message_deleted removes the captured entry', async () => {
    db.incidentEvent.deleteMany.mockResolvedValue({ count: 1 });
    const out = await captureSlackChannelMessage(
      msg({
        subtype: 'message_deleted',
        deleted_ts: '100.1',
        previous_message: { user: 'U1', ts: '100.1' },
      }),
      client
    );
    expect(out).toBe('REMOVED');
    expect(db.incidentEvent.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        incidentId: 'inc-1',
        createdAt: new Date(100_100),
        type: 'CHAT_MESSAGE',
      }),
    });
  });

  it('captures nothing while the switch is off', async () => {
    h.settings.mockResolvedValue({ enabled: true, warRoomCaptureEnabled: false });
    expect(await captureSlackChannelMessage(msg({ text: 'hello there', ts: '1.1' }), client)).toBe(
      'DISABLED'
    );
    expect(db.incidentEvent.deleteMany).not.toHaveBeenCalled();
  });
});
