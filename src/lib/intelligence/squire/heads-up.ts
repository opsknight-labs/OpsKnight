import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { resolveUserActor } from '@/lib/authorization-actors';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import { loadShiftRiskSignals } from '@/lib/oncall-load/signals';
import { getSlackBotToken } from '@/lib/slack';
import { slackApiCall } from '@/lib/war-room/providers/slack/client';
import { getAiSettings } from '../ai/settings';

/**
 * On-call heads-up: shortly before a person's shift starts, Squire sends them a short briefing (open incidents
 * on the shift's services, recent changes and anything flagged), in the app and as a Slack direct message when
 * their Slack account is linked. Built for that person: only what they may read. Sent once per shift
 * (SquireHeadsUp), never to someone who switched it off.
 */

/** The profile offers 15, 30, 60 or 120 minutes; the window searched for upcoming shifts is the longest. */
export const HEADS_UP_MAX_LEAD_MINUTES = 120;
const DEFAULT_LEAD = 60;
const RECENT_CHANGE_HOURS = 24;
const MAX_LINES = 3;

const RISK_LABEL = {
  RISKY_CHANGE: 'a risky change',
  SLO_BURNING: 'an SLO burning error budget',
  MAINTENANCE_ENDING: 'maintenance ending',
} as const;

export interface HeadsUpBriefing {
  title: string;
  lines: string[];
}

const short = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Ids of `serviceIds` the actor may read; none when they may read no service at all. */
async function readableServices(actor: AuthorizationActor, serviceIds: readonly string[]) {
  try {
    const rows = await prisma.service.findMany({
      where: { AND: [{ id: { in: [...serviceIds] } }, serviceReadWhere(actor)] },
      select: { id: true },
    });
    return rows.map(row => row.id);
  } catch {
    return [];
  }
}

/** The briefing for one person and one shift, scoped to what that person may read. */
export async function buildHeadsUpBriefing(
  actor: AuthorizationActor,
  shift: { scheduleName: string; start: Date; serviceIds: readonly string[] },
  now = new Date()
): Promise<HeadsUpBriefing> {
  const minutes = Math.max(1, Math.round((shift.start.getTime() - now.getTime()) / 60_000));
  const services = await readableServices(actor, shift.serviceIds);
  let incidentScope: Prisma.IncidentWhereInput | null = null;
  try {
    incidentScope = incidentReadWhere(actor);
  } catch {
    incidentScope = null;
  }
  const open: Prisma.IncidentWhereInput = {
    serviceId: { in: services },
    status: { in: ['OPEN', 'ACKNOWLEDGED'] },
  };
  const [incidents, openCount, changes, flags] = await Promise.all([
    incidentScope && services.length
      ? prisma.incident.findMany({
          where: { AND: [open, incidentScope] },
          orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
          take: MAX_LINES,
          select: { title: true, urgency: true, service: { select: { name: true } } },
        })
      : [],
    incidentScope && services.length
      ? prisma.incident.count({ where: { AND: [open, incidentScope] } })
      : 0,
    services.length
      ? prisma.changeEvent.findMany({
          where: {
            serviceId: { in: services },
            occurredAt: { gte: new Date(now.getTime() - RECENT_CHANGE_HOURS * 3_600_000) },
          },
          orderBy: { occurredAt: 'desc' },
          take: MAX_LINES,
          select: { summary: true, service: { select: { name: true } } },
        })
      : [],
    loadShiftRiskSignals(services, { now, shiftEnd: new Date(now.getTime() + 12 * 3_600_000) }),
  ]);
  const lines = [
    openCount === 0
      ? 'No open incidents on your services.'
      : `${openCount} open incident${openCount === 1 ? '' : 's'}: ${incidents
          .map(
            incident => `[${incident.urgency}] ${short(incident.title)} (${incident.service.name})`
          )
          .join('; ')}${openCount > incidents.length ? '; …' : ''}`,
    ...(changes.length
      ? [
          `Recent changes: ${changes
            .map(change => `${short(change.summary)} (${change.service?.name ?? 'unmapped'})`)
            .join('; ')}`,
        ]
      : []),
    ...(flags.length
      ? [
          `Flagged: ${flags
            .map(flag => `${flag.serviceName} has ${RISK_LABEL[flag.kind]}`)
            .join('; ')}`,
        ]
      : []),
  ];
  return {
    title: `Squire heads-up: on call for ${short(shift.scheduleName, 60)} in ${minutes} min`,
    lines,
  };
}

const shiftKeyOf = (scheduleId: string, start: Date) => `${scheduleId}:${start.toISOString()}`;

/**
 * Scheduled every scheduler tick: finds shifts that start within each person's lead time and sends each
 * person one heads-up per shift. People already on call on that schedule are skipped, like shift reminders.
 * Returns how many heads-ups were sent; never throws for one person's failure.
 */
export async function sendSquireHeadsUps(now = new Date()): Promise<number> {
  const ai = await getAiSettings();
  if (!ai.enabled || !ai.squireEnabled) return 0;
  const shifts = await getWindowOnCallShifts(
    now,
    new Date(now.getTime() + HEADS_UP_MAX_LEAD_MINUTES * 60_000)
  );
  const onCallNow = new Set(
    shifts
      .filter(shift => shift.start <= now && shift.end > now)
      .map(shift => `${shift.scheduleId}:${shift.userId}`)
  );
  const upcoming = shifts.filter(
    shift => shift.start > now && !onCallNow.has(`${shift.scheduleId}:${shift.userId}`)
  );
  if (upcoming.length === 0) return 0;
  const settings = new Map(
    (
      await prisma.squireUserSettings.findMany({
        where: { userId: { in: [...new Set(upcoming.map(shift => shift.userId))] } },
        select: { userId: true, headsUpEnabled: true, headsUpLeadMinutes: true },
      })
    ).map(row => [row.userId, row])
  );
  let sent = 0;
  for (const shift of upcoming) {
    const own = settings.get(shift.userId);
    if (own && !own.headsUpEnabled) continue;
    const lead = Math.min(own?.headsUpLeadMinutes ?? DEFAULT_LEAD, HEADS_UP_MAX_LEAD_MINUTES);
    if (shift.start.getTime() - now.getTime() > lead * 60_000) continue;
    try {
      if (await sendHeadsUp(shift, now, ai.squireChatOpsEnabled)) sent += 1;
    } catch (error) {
      logger.warn('[Squire] On-call heads-up failed', {
        userId: shift.userId,
        scheduleId: shift.scheduleId,
        error: error instanceof Error ? error.name : 'error',
      });
    }
  }
  return sent;
}

async function sendHeadsUp(
  shift: { userId: string; scheduleId: string; schedule: { name: string }; start: Date },
  now: Date,
  chatOps: boolean
): Promise<boolean> {
  const shiftKey = shiftKeyOf(shift.scheduleId, shift.start);
  // Claimed before sending: a heads-up may be lost to a crash, but is never sent twice.
  // ON CONFLICT DO NOTHING: a shift already claimed is the normal case on every later run, not an error to log.
  const [claim] = await prisma.squireHeadsUp.createManyAndReturn({
    data: [{ userId: shift.userId, shiftKey }],
    skipDuplicates: true,
    select: { id: true },
  });
  if (!claim) return false;
  const actor = await resolveUserActor(shift.userId);
  if (!actor || actor.status !== 'ACTIVE') return false;
  const policies = await prisma.escalationPolicy.findMany({
    where: { steps: { some: { targetType: 'SCHEDULE', targetScheduleId: shift.scheduleId } } },
    select: { services: { select: { id: true } } },
  });
  const briefing = await buildHeadsUpBriefing(
    actor,
    {
      scheduleName: shift.schedule.name,
      start: shift.start,
      serviceIds: policies.flatMap(policy => policy.services.map(service => service.id)),
    },
    now
  );
  const channels = ['IN_APP'];
  await createInAppNotifications({
    userIds: [shift.userId],
    type: 'SCHEDULE',
    title: briefing.title,
    message: briefing.lines.join('\n'),
    entityType: 'SCHEDULE',
    entityId: shift.scheduleId,
    dedupeKey: `squire-heads-up:${shiftKey}`,
  });
  if (chatOps && (await sendSlackHeadsUp(shift.userId, briefing))) channels.push('SLACK');
  await prisma.squireHeadsUp.update({ where: { id: claim.id }, data: { channels } });
  return true;
}

/**
 * A Slack direct message (posted to the user's id, which opens the app's DM) for a linked, unrevoked account.
 * shortcut: Microsoft Teams has no personal-chat sender yet, so linked Teams users get the in-app heads-up only;
 * add one when the Teams bot stores personal conversation references.
 */
async function sendSlackHeadsUp(userId: string, briefing: HeadsUpBriefing): Promise<boolean> {
  const link = await prisma.chatIdentityLink.findFirst({
    where: { userId, provider: 'SLACK', revokedAt: null },
    orderBy: { verifiedAt: 'desc' },
    select: { providerUserId: true },
  });
  if (!link) return false;
  const token = await getSlackBotToken();
  if (!token) return false;
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const result = await slackApiCall('chat.postMessage', token, {
    channel: link.providerUserId,
    text: [`*${escape(briefing.title)}*`, ...briefing.lines.map(line => `• ${escape(line)}`)].join(
      '\n'
    ),
    unfurl_links: false,
    unfurl_media: false,
  });
  return result.ok;
}
