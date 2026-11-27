import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { resolveEscalationTarget } from '@/lib/escalation/target-resolution';
import { getSlackInstall } from '@/lib/slack';
import { callSlackApi } from './api';
import { lookupSlackUserIdByEmail, type SlackInstall } from './live-card';

export const ONCALL_SYNC_MIN_INTERVAL_MS = 60_000;
export const ONCALL_SYNC_MAX_MEMBERS = 50;
const PASS_LIMIT = 50;

export type OnCallSyncOutcome =
  { status: 'synced'; members: number; unmatched: number } | { status: 'skipped'; reason: string };

async function record(scheduleId: string, lastError: string | null, synced: boolean) {
  await prisma.slackOnCallSync.update({
    where: { scheduleId },
    data: { lastError, ...(synced ? { lastSyncedAt: new Date() } : {}) },
  });
}

/**
 * Make a Slack user group equal the schedule's current on-call people. usergroups.users.update REPLACES
 * membership, so an empty list is never sent: a gap in coverage keeps the previous members.
 */
export async function syncScheduleUsergroup(
  mapping: { scheduleId: string; usergroupId: string; enabled: boolean },
  install: SlackInstall | null
): Promise<OnCallSyncOutcome> {
  const skip = async (reason: string): Promise<OnCallSyncOutcome> => {
    await record(mapping.scheduleId, reason, false);
    return { status: 'skipped', reason };
  };
  if (!mapping.enabled) return { status: 'skipped', reason: 'disabled' };
  if (!install) return skip('Slack is not connected');
  if (!install.scopes.includes('usergroups:write')) return skip('missing usergroups:write scope');

  const userIds = await resolveEscalationTarget('SCHEDULE', mapping.scheduleId);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, status: 'ACTIVE' },
        select: { id: true, email: true },
      })
    : [];
  const slackIds = new Set<string>();
  let unmatched = 0;
  for (const user of users) {
    const id = await lookupSlackUserIdByEmail(install, user.email).catch(() => null);
    if (id) slackIds.add(id);
    else unmatched += 1;
  }
  if (slackIds.size === 0) {
    return skip(
      users.length === 0 ? 'nobody is on call' : 'no on-call user matched a Slack account'
    );
  }

  const result = await callSlackApi('usergroups.users.update', install.token, {
    usergroup: mapping.usergroupId,
    users: [...slackIds].sort().slice(0, ONCALL_SYNC_MAX_MEMBERS).join(','),
  });
  if (!result.ok) {
    return skip(
      result.status === 429
        ? `rate limited, retrying in ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}s`
        : result.error
    );
  }
  await record(mapping.scheduleId, null, true);
  return { status: 'synced', members: Math.min(slackIds.size, ONCALL_SYNC_MAX_MEMBERS), unmatched };
}

/** One bounded pass over enabled mappings, run from the cron scheduler tick. */
export async function runOnCallSyncPass(now: Date = new Date()): Promise<{ synced: number }> {
  const due = await prisma.slackOnCallSync.findMany({
    where: {
      enabled: true,
      OR: [
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: new Date(now.getTime() - ONCALL_SYNC_MIN_INTERVAL_MS) } },
      ],
    },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: PASS_LIMIT,
  });
  if (due.length === 0) return { synced: 0 };
  const install = await getSlackInstall();
  let synced = 0;
  for (const mapping of due) {
    try {
      if ((await syncScheduleUsergroup(mapping, install)).status === 'synced') synced += 1;
    } catch (error) {
      logger.warn('[Slack] on-call usergroup sync failed', {
        scheduleId: mapping.scheduleId,
        error,
      });
    }
  }
  return { synced };
}

export async function listSlackUsergroups(
  install: SlackInstall
): Promise<Array<{ id: string; handle: string; name: string }> | null> {
  if (!install.scopes.includes('usergroups:read')) return null;
  const res = await callSlackApi<{
    usergroups?: Array<{ id: string; handle: string; name: string }>;
  }>('usergroups.list', install.token, {}, { form: true });
  return res.ok ? (res.data.usergroups ?? []) : null;
}
