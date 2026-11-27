/**
 * Slack channel nudges: a thread reply on the live incident card when nobody has acknowledged an
 * incident ("unacked") or an open incident has gone quiet ("noupdate"). Off unless the ChatOps
 * settings carry minutes. Each nudge is a delayed SCHEDULED_TASK job (task SLACK_NUDGE) that re-reads
 * the incident when it fires and ends silently once the condition is gone, so nothing has to be
 * cancelled. The job re-arms itself for the next nudge, up to NUDGE_CAP.
 */
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { callSlackApi, classifySlackError } from './api';

export const NUDGE_CAP = 6;
export const NUDGE_TASK = 'SLACK_NUDGE';
const MINUTE_MS = 60_000;

export type NudgeKind = 'unacked' | 'noupdate';

export const nudgePayloadSchema = z.object({
  task: z.literal(NUDGE_TASK),
  incidentId: z.string().min(1),
  kind: z.enum(['unacked', 'noupdate']),
  /** Nudges already sent in this streak. */
  seq: z.number().int().min(0).max(NUDGE_CAP),
  /** Last activity (ms) the streak was counted against; newer activity restarts it. */
  since: z.number().int().min(0),
  dedupeKey: z.string().min(1),
});
export type NudgePayload = z.infer<typeof nudgePayloadSchema>;

type NudgeSettings = { unacked: number | null; noupdate: number | null };

async function loadSettings(): Promise<NudgeSettings> {
  const row = await prisma.chatOpsConfig.findUnique({
    where: { id: 'default' },
    select: { slackUnackedNudgeMinutes: true, slackNoUpdateNudgeMinutes: true },
  });
  const ok = (value: number | null | undefined) =>
    typeof value === 'number' && value >= 1 && value <= 1440 ? value : null;
  return {
    unacked: ok(row?.slackUnackedNudgeMinutes),
    noupdate: ok(row?.slackNoUpdateNudgeMinutes),
  };
}

// Timeline rows that count as a human update (system noise such as SLA warnings does not).
const UPDATE_EVENT_TYPES = [
  'COMMENT',
  'STATUS_CHANGE',
  'ACKNOWLEDGED',
  'ASSIGNMENT',
  'REOPENED',
  'ROLE_ASSIGNED',
  'CHAT_MESSAGE',
] as const;

/** Newest note or update event, falling back to when the incident opened. */
export async function lastIncidentActivityAt(incidentId: string, openedAt: Date): Promise<Date> {
  const [note, event] = await Promise.all([
    prisma.incidentNote.findFirst({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.incidentEvent.findFirst({
      where: { incidentId, type: { in: [...UPDATE_EVENT_TYPES] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  return new Date(
    Math.max(openedAt.getTime(), note?.createdAt.getTime() ?? 0, event?.createdAt.getTime() ?? 0)
  );
}

/** Creates the job unless one with this key exists (any status), so a retry never doubles a nudge. */
async function scheduleOnce(
  at: Date,
  payload: Omit<NudgePayload, 'dedupeKey'> & { dueMs: number }
) {
  const { dueMs, ...rest } = payload;
  const dedupeKey = `${rest.incidentId}:${rest.kind}:${rest.seq}:${dueMs}`;
  const existing = await prisma.backgroundJob.findFirst({
    where: { type: 'SCHEDULED_TASK', payload: { path: ['dedupeKey'], equals: dedupeKey } },
    select: { id: true },
  });
  if (existing) return;
  const { scheduleJob } = await import('@/lib/jobs/queue');
  await scheduleJob('SCHEDULED_TASK', at, { ...rest, dedupeKey });
}

/**
 * Called once a live Slack card exists. Arms the first nudge of each enabled kind unless a chain
 * for that kind is already pending (a replaced card must not start a second chain).
 */
export async function armSlackNudges(incidentId: string, now: Date = new Date()): Promise<void> {
  const settings = await loadSettings();
  if (!settings.unacked && !settings.noupdate) return;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { status: true, createdAt: true },
  });
  if (!incident || incident.status === 'RESOLVED') return;
  for (const kind of ['unacked', 'noupdate'] as const) {
    const minutes = kind === 'unacked' ? settings.unacked : settings.noupdate;
    if (!minutes) continue;
    const pending = await prisma.backgroundJob.findFirst({
      where: {
        type: 'SCHEDULED_TASK',
        status: { in: ['PENDING', 'PROCESSING'] },
        AND: [
          { payload: { path: ['task'], equals: NUDGE_TASK } },
          { payload: { path: ['incidentId'], equals: incidentId } },
          { payload: { path: ['kind'], equals: kind } },
        ],
      },
      select: { id: true },
    });
    if (pending) continue;
    const base =
      kind === 'unacked'
        ? incident.createdAt
        : await lastIncidentActivityAt(incidentId, incident.createdAt);
    const dueMs = base.getTime() + minutes * MINUTE_MS;
    await scheduleOnce(new Date(Math.max(dueMs, now.getTime())), {
      task: NUDGE_TASK,
      incidentId,
      kind,
      seq: 0,
      since: base.getTime(),
      dueMs,
    });
  }
}

function nudgeText(kind: NudgeKind, minutes: number): string {
  return kind === 'unacked'
    ? `No one has acknowledged this yet (${minutes} min). Acknowledge, or escalate.`
    : `No update in ${minutes} minutes.`;
}

/** Job handler. Throws only for a Slack failure worth retrying; everything else ends quietly. */
export async function processSlackNudge(
  rawPayload: unknown,
  now: Date = new Date()
): Promise<void> {
  const parsed = nudgePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return;
  const payload = parsed.data;
  const loaded = await loadSettings();
  const minutes = payload.kind === 'unacked' ? loaded.unacked : loaded.noupdate;
  if (!minutes) return;

  const incident = await prisma.incident.findUnique({
    where: { id: payload.incidentId },
    select: { status: true, createdAt: true, serviceId: true, acknowledgedAt: true },
  });
  if (!incident) return;
  const live =
    payload.kind === 'unacked'
      ? incident.status === 'OPEN' && !incident.acknowledgedAt
      : incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED';
  if (!live) return;

  const base =
    payload.kind === 'unacked'
      ? incident.createdAt
      : await lastIncidentActivityAt(payload.incidentId, incident.createdAt);
  // Newer activity than the streak was counted against: start over from zero.
  const seq = base.getTime() > payload.since ? 0 : payload.seq;
  const dueMs = base.getTime() + minutes * MINUTE_MS * (seq + 1);
  const next = (nextSeq: number, at: number) =>
    scheduleOnce(new Date(at), {
      task: NUDGE_TASK,
      incidentId: payload.incidentId,
      kind: payload.kind,
      seq: nextSeq,
      since: base.getTime(),
      dueMs: at,
    });
  if (now.getTime() < dueMs) {
    await next(seq, dueMs);
    return;
  }

  // Re-arm first (deduped), so a Slack retry of this job cannot lose or double the chain.
  if (seq + 1 < NUDGE_CAP) {
    await next(
      seq + 1,
      Math.max(
        base.getTime() + minutes * MINUTE_MS * (seq + 2),
        now.getTime() + minutes * MINUTE_MS
      )
    );
  }

  const cards = await prisma.slackIncidentMessage.findMany({
    where: { incidentId: payload.incidentId, ts: { not: null }, channelId: { not: null } },
    select: { channelId: true, ts: true },
  });
  if (cards.length === 0) return;
  const { getSlackInstall } = await import('@/lib/slack');
  const install = await getSlackInstall(incident.serviceId);
  if (!install) return;
  const text = nudgeText(payload.kind, minutes * (seq + 1));
  for (const card of cards) {
    const result = await callSlackApi(
      'chat.postMessage',
      install.token,
      { channel: card.channelId, thread_ts: card.ts, text },
      { maxAttempts: 2 }
    );
    if (result.ok) continue;
    const kind = classifySlackError(result.error, result.status);
    if (kind === 'rate_limited' || kind === 'retryable') {
      throw new Error(`Slack nudge not delivered (${result.error})`);
    }
    logger.warn('[Slack] Nudge reply skipped', {
      incidentId: payload.incidentId,
      error: result.error,
    });
  }
}
