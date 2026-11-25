import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { FIRST_STEP_SELECT } from './on-call';
import {
  evaluateHygiene,
  hygieneDedupeKey,
  hygieneMessage,
  hygieneTitle,
  isRecentlyNotified,
  type HygieneReason,
} from './hygiene';

const SWEEP_INTERVAL_MS = 60 * 60_000;
const BATCH = 500;
let lastRunAt = 0;

export async function isHygieneEnabled(): Promise<boolean> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { businessServiceHygieneEnabled: true },
  });
  return settings?.businessServiceHygieneEnabled ?? false;
}

/**
 * Cron entry: at most hourly per process, and only when an admin enabled it. The 7-day dedupe
 * lives in the notification table, so a restart or a second instance never re-sends.
 */
export async function runBusinessServiceHygieneIfDue(now = new Date()) {
  if (now.getTime() - lastRunAt < SWEEP_INTERVAL_MS) return null;
  lastRunAt = now.getTime();
  if (!(await isHygieneEnabled())) return null;
  return runBusinessServiceHygieneSweep(now);
}

export async function runBusinessServiceHygieneSweep(now = new Date()) {
  let notified = 0;
  let flagged = 0;
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
    take: 20,
  });
  for (let cursor: string | undefined; ;) {
    const services = await prisma.businessService.findMany({
      where: {
        lifecycle: { in: ['ACTIVE', 'BETA'] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastReviewedAt: true,
        reviewIntervalDays: true,
        ownerUserId: true,
        ownerUser: { select: { status: true } },
        ownerTeamId: true,
        ownerTeam: {
          select: {
            members: {
              select: { role: true, user: { select: { id: true, role: true, status: true } } },
            },
          },
        },
        escalationPolicy: {
          select: { steps: FIRST_STEP_SELECT },
        },
      },
    });
    if (!services.length) break;
    cursor = services[services.length - 1].id;
    const recent = await prisma.inAppNotification.findMany({
      where: {
        entityType: 'BUSINESS_SERVICE',
        entityId: { in: services.map(service => service.id) },
        createdAt: { gt: new Date(now.getTime() - 8 * 86_400_000) },
        title: { startsWith: 'Business service hygiene:' },
      },
      select: { entityId: true, title: true, createdAt: true },
    });
    for (const service of services) {
      const members = service.ownerTeam?.members ?? [];
      const activeMembers = members.filter(member => member.user.status === 'ACTIVE');
      let teamUnreachable: boolean | null = null;
      if (service.ownerTeamId) {
        const scheduleId = service.escalationPolicy?.steps[0]?.targetScheduleId;
        teamUnreachable =
          activeMembers.length === 0 ||
          (scheduleId ? (await getActiveOnCallShifts(now, { scheduleId })).length === 0 : false);
      }
      const reasons = evaluateHygiene(
        {
          createdAt: service.createdAt,
          lastReviewedAt: service.lastReviewedAt,
          reviewIntervalDays: service.reviewIntervalDays,
          ownerUserId: service.ownerUserId,
          ownerUserStatus: service.ownerUser?.status ?? null,
          ownerTeamId: service.ownerTeamId,
          teamUnreachable,
        },
        now
      );
      flagged += reasons.length;
      // Active owner and the team's responders; the org admins when nobody else can act.
      const responders = activeMembers
        .filter(member => member.user.role === 'ADMIN' || member.user.role === 'RESPONDER')
        .map(member => member.user.id);
      const recipients = [
        ...(service.ownerUser?.status === 'ACTIVE' && service.ownerUserId
          ? [service.ownerUserId]
          : []),
        ...responders,
      ];
      for (const reason of reasons as HygieneReason[]) {
        if (isRecentlyNotified(recent, service.id, reason, now)) continue;
        const userIds = recipients.length ? recipients : admins.map(admin => admin.id);
        await createInAppNotifications({
          userIds,
          type: 'SERVICE',
          title: hygieneTitle(reason),
          message: hygieneMessage(service.name, reason, service.reviewIntervalDays),
          entityType: 'BUSINESS_SERVICE',
          entityId: service.id,
          dedupeKey: hygieneDedupeKey(service.id, reason, now),
        });
        notified += 1;
      }
    }
    if (services.length < BATCH) break;
  }
  logger.info('[Hygiene] Business-service ownership sweep finished', { flagged, notified });
  return { flagged, notified };
}
