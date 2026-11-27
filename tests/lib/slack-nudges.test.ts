import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  chatOpsConfig: { findUnique: vi.fn() },
  incident: { findUnique: vi.fn() },
  incidentNote: { findFirst: vi.fn() },
  incidentEvent: { findFirst: vi.fn() },
  slackIncidentMessage: { findMany: vi.fn() },
  backgroundJob: { findFirst: vi.fn() },
}));
const h = vi.hoisted(() => ({
  scheduleJob: vi.fn(),
  callSlackApi: vi.fn(),
  getSlackInstall: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/jobs/queue', () => ({ scheduleJob: h.scheduleJob }));
vi.mock('@/lib/slack', () => ({ getSlackInstall: h.getSlackInstall }));
vi.mock('@/lib/slack/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/slack/api')>()),
  callSlackApi: h.callSlackApi,
}));

import { armSlackNudges, NUDGE_CAP, processSlackNudge } from '@/lib/slack/nudges';

const T0 = new Date('2026-12-01T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const payload = (over: Record<string, unknown> = {}) => ({
  task: 'SLACK_NUDGE',
  incidentId: 'inc-1',
  kind: 'unacked',
  seq: 0,
  since: T0.getTime(),
  dedupeKey: 'k',
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.chatOpsConfig.findUnique.mockResolvedValue({
    slackUnackedNudgeMinutes: 15,
    slackNoUpdateNudgeMinutes: null,
  });
  db.incident.findUnique.mockResolvedValue({
    status: 'OPEN',
    createdAt: T0,
    serviceId: 's1',
    acknowledgedAt: null,
  });
  db.incidentNote.findFirst.mockResolvedValue(null);
  db.incidentEvent.findFirst.mockResolvedValue(null);
  db.backgroundJob.findFirst.mockResolvedValue(null);
  db.slackIncidentMessage.findMany.mockResolvedValue([{ channelId: 'C1', ts: '1.1' }]);
  h.callSlackApi.mockResolvedValue({ ok: true, data: {} });
  h.getSlackInstall.mockResolvedValue({ token: 'xoxb', scopes: [], workspaceId: 'T1' });
});

describe('unacknowledged nudge', () => {
  it('posts one thread reply when due and schedules the next', async () => {
    await processSlackNudge(payload(), at(15));
    expect(h.callSlackApi).toHaveBeenCalledTimes(1);
    expect(h.callSlackApi).toHaveBeenCalledWith(
      'chat.postMessage',
      'xoxb',
      expect.objectContaining({
        channel: 'C1',
        thread_ts: '1.1',
        text: 'No one has acknowledged this yet (15 min). Acknowledge, or escalate.',
      }),
      expect.anything()
    );
    expect(h.scheduleJob).toHaveBeenCalledWith(
      'SCHEDULED_TASK',
      expect.any(Date),
      expect.objectContaining({ kind: 'unacked', seq: 1 })
    );
  });

  it('is silent for resolved, acknowledged, snoozed or suppressed incidents', async () => {
    for (const row of [
      { status: 'RESOLVED', acknowledgedAt: null },
      { status: 'ACKNOWLEDGED', acknowledgedAt: at(5) },
      { status: 'SNOOZED', acknowledgedAt: null },
      { status: 'SUPPRESSED', acknowledgedAt: null },
    ]) {
      db.incident.findUnique.mockResolvedValue({ createdAt: T0, serviceId: 's1', ...row });
      await processSlackNudge(payload(), at(15));
    }
    expect(h.callSlackApi).not.toHaveBeenCalled();
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off', async () => {
    db.chatOpsConfig.findUnique.mockResolvedValue({ slackUnackedNudgeMinutes: null });
    await processSlackNudge(payload(), at(15));
    expect(h.callSlackApi).not.toHaveBeenCalled();
  });

  it('re-arms instead of posting when it fires early', async () => {
    await processSlackNudge(payload(), at(5));
    expect(h.callSlackApi).not.toHaveBeenCalled();
    expect(h.scheduleJob).toHaveBeenCalledWith(
      'SCHEDULED_TASK',
      at(15),
      expect.objectContaining({ seq: 0 })
    );
  });

  it('stops re-arming at the cap', async () => {
    await processSlackNudge(payload({ seq: NUDGE_CAP - 1 }), at(15 * NUDGE_CAP));
    expect(h.callSlackApi).toHaveBeenCalledTimes(1);
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });

  it('does not double-schedule an existing key', async () => {
    db.backgroundJob.findFirst.mockResolvedValue({ id: 'existing' });
    await processSlackNudge(payload(), at(15));
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });

  it('throws on a rate limit so the queue retries', async () => {
    h.callSlackApi.mockResolvedValue({ ok: false, error: 'ratelimited', status: 429 });
    await expect(processSlackNudge(payload(), at(15))).rejects.toThrow();
  });

  it('swallows a permanent Slack error', async () => {
    h.callSlackApi.mockResolvedValue({ ok: false, error: 'is_archived' });
    await expect(processSlackNudge(payload(), at(15))).resolves.toBeUndefined();
  });
});

describe('no-update nudge', () => {
  const noUpdate = (over: Record<string, unknown> = {}) => payload({ kind: 'noupdate', ...over });
  beforeEach(() => {
    db.chatOpsConfig.findUnique.mockResolvedValue({
      slackUnackedNudgeMinutes: null,
      slackNoUpdateNudgeMinutes: 30,
    });
  });

  it('posts for an acknowledged incident with no update', async () => {
    db.incident.findUnique.mockResolvedValue({
      status: 'ACKNOWLEDGED',
      createdAt: T0,
      serviceId: 's1',
      acknowledgedAt: at(1),
    });
    await processSlackNudge(noUpdate(), at(30));
    expect(h.callSlackApi.mock.calls[0][2].text).toBe('No update in 30 minutes.');
  });

  it('a newer note resets the streak and defers the nudge', async () => {
    db.incidentNote.findFirst.mockResolvedValue({ createdAt: at(20) });
    await processSlackNudge(noUpdate({ seq: 3 }), at(30));
    expect(h.callSlackApi).not.toHaveBeenCalled();
    expect(h.scheduleJob).toHaveBeenCalledWith(
      'SCHEDULED_TASK',
      at(50),
      expect.objectContaining({ seq: 0, kind: 'noupdate' })
    );
  });
});

describe('arming', () => {
  it('arms nothing when both settings are off', async () => {
    db.chatOpsConfig.findUnique.mockResolvedValue(null);
    await armSlackNudges('inc-1', at(1));
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });

  it('arms the first unacked nudge once', async () => {
    await armSlackNudges('inc-1', at(1));
    expect(h.scheduleJob).toHaveBeenCalledTimes(1);
    expect(h.scheduleJob).toHaveBeenCalledWith(
      'SCHEDULED_TASK',
      at(15),
      expect.objectContaining({ kind: 'unacked', seq: 0 })
    );
  });

  it('does not start a second chain while one is pending', async () => {
    db.backgroundJob.findFirst.mockResolvedValue({ id: 'pending' });
    await armSlackNudges('inc-1', at(1));
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });
});
