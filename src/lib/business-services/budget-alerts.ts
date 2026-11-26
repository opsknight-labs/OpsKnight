import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import type { BurnState, ErrorBudget } from './slo';
import { isErrorBudgetAlertsEnabled } from './reviews/config';
import { errorBudgetFor } from './reviews/freeze-service';
import { businessServiceChatTargets, enqueueBusinessServiceChat } from './chat-channels';

const SWEEP_INTERVAL_MS = 15 * 60_000;
/** An improving state waits this long after the last alert, so a budget hovering at a threshold stays quiet. */
export const BUDGET_ALERT_DEBOUNCE_MS = 60 * 60_000;
const BATCH = 200;
const SEVERITY: Record<BurnState, number> = { OK: 0, AT_RISK: 1, BREACHED: 2 };
let lastRunAt = 0;

export type BudgetAlertDecision = 'NONE' | 'BASELINE' | 'DEBOUNCED' | 'NOTIFY';

/**
 * First sight records a baseline; a worse state alerts at once; a better one (recovery) only
 * once the debounce since the last alert has passed. Unknown stored values count as OK.
 */
export function budgetAlertDecision(
  previous: string | null,
  previousAt: Date | null,
  next: BurnState,
  now: Date
): BudgetAlertDecision {
  if (previous === next) return 'NONE';
  if (previous === null) return 'BASELINE';
  const before = SEVERITY[previous as BurnState] ?? 0;
  // eslint-disable-next-line security/detect-object-injection -- next is a closed BurnState
  if (SEVERITY[next] > before) return 'NOTIFY';
  return previousAt && now.getTime() - previousAt.getTime() < BUDGET_ALERT_DEBOUNCE_MS
    ? 'DEBOUNCED'
    : 'NOTIFY';
}

export function budgetAlertText(
  name: string,
  state: BurnState,
  budget: ErrorBudget,
  slo: { target: number; windowDays: number }
) {
  const left = Math.max(Math.round(budget.remainingPercent), 0);
  const window = `${slo.windowDays}-day`;
  if (state === 'BREACHED')
    return {
      title: `${name}: error budget exhausted`,
      message: `The ${window} error budget for the ${slo.target}% SLO is used up (${Math.round(budget.consumedMinutes)} of ${Math.round(budget.allowedMinutes)} minutes). Consider pausing risky changes.`,
    };
  if (state === 'AT_RISK')
    return {
      title: `${name}: error budget at risk`,
      message: `${left}% of the ${window} error budget for the ${slo.target}% SLO is left.`,
    };
  return {
    title: `${name}: error budget recovered`,
    message: `${left}% of the ${window} error budget for the ${slo.target}% SLO is left again.`,
  };
}

/** Cron entry: at most every 15 minutes per process, and only when an admin enabled it. */
export async function runErrorBudgetAlertsIfDue(now = new Date()) {
  if (now.getTime() - lastRunAt < SWEEP_INTERVAL_MS) return null;
  if (!(await isErrorBudgetAlertsEnabled())) return null;
  const previous = lastRunAt;
  lastRunAt = now.getTime();
  try {
    return await runErrorBudgetAlerts(now);
  } catch (error) {
    lastRunAt = previous;
    throw error;
  }
}

const SELECT = {
  id: true,
  name: true,
  sloTarget: true,
  sloWindowDays: true,
  contactChannel: true,
  ownerTeamId: true,
  lastBudgetState: true,
  lastBudgetStateAt: true,
  ownerUser: { select: { id: true, email: true, status: true } },
  ownerTeam: {
    select: {
      members: {
        where: { receiveTeamNotifications: true, user: { status: 'ACTIVE' as const } },
        select: { user: { select: { id: true, email: true } } },
      },
    },
  },
  followers: {
    where: { user: { status: 'ACTIVE' as const } },
    select: { user: { select: { id: true, email: true } } },
  },
} satisfies Prisma.BusinessServiceSelect;

/**
 * Compares each SLO'd business service's burn state with the last one alerted and tells the
 * owner (user and team) and followers in-app, by email and in its chat channels. At least once:
 * everything is written under a per-transition key, then `lastBudgetState` is compare-and-set,
 * so a restart or a second instance never re-sends and a failure is retried on the next sweep.
 */
export async function runErrorBudgetAlerts(now = new Date()) {
  let alerted = 0;
  for (let cursor: string | undefined; ;) {
    const rows = await prisma.businessService.findMany({
      where: {
        lifecycle: { not: 'RETIRED' },
        sloTarget: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: SELECT,
    });
    if (!rows.length) break;
    cursor = rows.at(-1)!.id;
    for (const row of rows) {
      try {
        if (await alertOne(row, now)) alerted += 1;
      } catch (error) {
        logger.warn('business_services.budget_alert_failed', {
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (rows.length < BATCH) break;
  }
  return { alerted };
}

type Row = Prisma.BusinessServiceGetPayload<{ select: typeof SELECT }>;

async function alertOne(row: Row, now: Date): Promise<boolean> {
  if (row.sloTarget === null) return false;
  const budget = await errorBudgetFor({ ...row, sloTarget: row.sloTarget }, now);
  const next = budget.burnState;
  const decision = budgetAlertDecision(row.lastBudgetState, row.lastBudgetStateAt, next, now);
  if (decision === 'NONE' || decision === 'DEBOUNCED') return false;
  const claim = () =>
    prisma.businessService.updateMany({
      where: { id: row.id, lastBudgetState: row.lastBudgetState },
      data: { lastBudgetState: next, lastBudgetStateAt: now },
    });
  if (decision === 'BASELINE') {
    await claim();
    return false;
  }

  const eventKey = `${row.id}:${row.lastBudgetState}:${next}:${row.lastBudgetStateAt?.getTime() ?? 0}`;
  const text = budgetAlertText(row.name, next, budget, {
    target: row.sloTarget,
    windowDays: row.sloWindowDays ?? 30,
  });
  const url = `${getBaseUrl()}/services/business/${row.id}`;
  const people = new Map<string, string | null>();
  if (row.ownerUser?.status === 'ACTIVE') people.set(row.ownerUser.id, row.ownerUser.email);
  for (const { user } of [...(row.ownerTeam?.members ?? []), ...row.followers])
    people.set(user.id, user.email);

  await createInAppNotifications({
    userIds: [...people.keys()],
    type: 'SERVICE',
    ...text,
    entityType: 'BUSINESS_SERVICE',
    entityId: row.id,
    dedupeKey: `business-service-budget:${eventKey}`,
  });
  const emails = [...people].filter(([, email]) => Boolean(email));
  if (emails.length) {
    const [{ renderEmail }, { StakeholderUpdateEmail }] = await Promise.all([
      import('@/emails/render'),
      import('@/emails/templates/stakeholder-update'),
    ]);
    const { html } = await renderEmail(
      StakeholderUpdateEmail({
        businessServiceNames: [row.name],
        phase: 'update',
        title: text.title,
        message: text.message,
        postedAt: now.toUTCString(),
        dashboardUrl: url,
        settingsUrl: `${getBaseUrl()}/settings/notifications`,
        eyebrow: 'Error budget',
        label:
          next === 'BREACHED'
            ? 'Budget exhausted'
            : next === 'AT_RISK'
              ? 'Budget at risk'
              : 'Budget recovered',
        tone: next === 'BREACHED' ? 'critical' : next === 'AT_RISK' ? 'elevated' : 'ok',
        buttonLabel: 'Open business service',
      }),
      { text: `${text.title}\n\n${text.message}\n\n${url}` }
    );
    for (const [userId, email] of emails)
      await createCentralNotificationIntent({
        userId,
        channel: 'EMAIL',
        category: 'SYSTEM',
        trafficClass: 'TRANSACTIONAL',
        recipientType: 'USER',
        recipientId: userId,
        recipientAddress: email!,
        templateKey: 'business-service-error-budget',
        sourceType: 'BUSINESS_SERVICE',
        sourceId: row.id,
        eventKey,
        displayMessage: text.title,
        payload: { kind: 'EMAIL', to: email!, subject: text.title, html, text: text.message },
      });
  }
  const targets = await businessServiceChatTargets(row);
  if (targets.length)
    await enqueueBusinessServiceChat({
      businessServiceId: row.id,
      targets,
      title: text.title,
      text: text.message,
      url,
      templateKey: 'business-service-error-budget-chat',
      eventKey,
    });
  return (await claim()).count > 0;
}
