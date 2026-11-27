import 'server-only';
/**
 * Slack App Home tab. `app_home_opened` is queued as a durable intent (the events route acknowledges
 * at once); the worker builds the viewer's own view, under their own read access, and publishes it.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeError } from '@/lib/errors';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { escapeSlack } from '@/lib/chatops/squire/render';

const SECTION_LIMIT = 10;
const TEXT_LIMIT = 150;

type Block = Record<string, unknown>;
type HomeIncident = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  service: { name: string };
};
type OnCallRow = { scheduleName: string; onCall: Array<{ name: string | null }> };

const mrkdwn = (text: string) => ({
  type: 'section',
  text: { type: 'mrkdwn', text: text.slice(0, 2900) },
});
const header = (text: string) => ({
  type: 'header',
  text: { type: 'plain_text', text, emoji: true },
});

/** Pure view builder; every section is bounded so the view stays far below Slack's 100-block limit. */
export function buildHomeView(input: {
  baseUrl: string;
  onCall: OnCallRow[];
  mine: HomeIncident[];
  open: HomeIncident[];
}) {
  const incidentBlocks = (incidents: HomeIncident[]): Block[] =>
    incidents.slice(0, SECTION_LIMIT).flatMap(incident => [
      mrkdwn(
        `${incident.status === 'ACKNOWLEDGED' ? '🟡' : '🔴'} *${escapeSlack(incident.title.slice(0, TEXT_LIMIT))}*\n${escapeSlack(incident.service.name.slice(0, 80))} · ${incident.urgency.toLowerCase()} urgency`
      ),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View', emoji: true },
            action_id: 'view_incident',
            url: `${input.baseUrl}/incidents/${incident.id}`,
          },
          ...(incident.status === 'OPEN'
            ? [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Acknowledge', emoji: true },
                  action_id: 'ack_incident',
                  value: JSON.stringify({ action: 'ack', incidentId: incident.id }),
                },
              ]
            : []),
        ],
      },
    ]);
  const onCallLines = input.onCall
    .slice(0, SECTION_LIMIT)
    .map(
      row =>
        `• *${escapeSlack(row.scheduleName.slice(0, 80))}*: ${
          row.onCall.map(entry => escapeSlack(entry.name ?? 'someone')).join(', ') || '_nobody_'
        }`
    );
  const blocks: Block[] = [
    header('OpsKnight'),
    mrkdwn(`*On call now*\n${onCallLines.join('\n') || '_You are not on any schedule._'}`),
    { type: 'divider' },
    mrkdwn('*My open incidents*'),
    ...(input.mine.length ? incidentBlocks(input.mine) : [mrkdwn('_Nothing assigned to you._')]),
    { type: 'divider' },
    mrkdwn('*Open incidents*'),
    ...(input.open.length ? incidentBlocks(input.open) : [mrkdwn('✅ _No other open incidents._')]),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'danger',
          text: { type: 'plain_text', text: 'Declare incident', emoji: true },
          action_id: 'home_declare_incident',
          value: JSON.stringify({ action: 'declare_home' }),
        },
      ],
    },
  ];
  return { type: 'home', blocks };
}

export function buildUnlinkedHomeView() {
  return {
    type: 'home',
    blocks: [
      header('OpsKnight'),
      mrkdwn(
        '⚠️ Your Slack account is not linked to an active OpsKnight account. Make sure your Slack email matches your OpsKnight email, then reopen this tab.'
      ),
    ],
  };
}

type HomeEnvelope = {
  team_id?: unknown;
  enterprise_id?: unknown;
  event_id?: unknown;
  event?: { type?: unknown; user?: unknown; tab?: unknown };
};
export type AppHomePayload = {
  __kind: 'APP_HOME';
  team_id: string;
  enterprise_id?: string;
  user_id: string;
};
const str = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Events route: queues a refresh for the Home tab (not Messages); false for any other event. */
export async function enqueueAppHome(envelope: HomeEnvelope): Promise<boolean> {
  const event = envelope.event;
  if (!event || event.type !== 'app_home_opened' || (event.tab && event.tab !== 'home'))
    return false;
  const teamId = str(envelope.team_id, 64);
  const userId = str(event.user, 64);
  if (!teamId || !userId) return false;
  const enterpriseId = str(envelope.enterprise_id, 64);
  const payload: AppHomePayload = {
    __kind: 'APP_HOME',
    team_id: teamId,
    ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
    user_id: userId,
  };
  // Keyed by event id; without one, by minute, so reopening the tab repeatedly does not pile up work.
  const key = str(envelope.event_id, 128) || `${userId}:${Math.floor(Date.now() / 60_000)}`;
  await enqueueChatOpsIntent({
    provider: 'SLACK',
    kind: 'SLASH_COMMAND',
    signature: `app-home:${teamId}:${key}`,
    workspaceId: teamId,
    channelId: '',
    slackUserId: userId,
    responseMode: 'DEFERRED',
    payload: { ...payload },
  });
  return true;
}

/** Worker: builds and publishes the viewer's Home view. Returns null (no response_url). Never throws on Slack errors. */
export async function processAppHome(payload: AppHomePayload): Promise<null> {
  try {
    const { workspaceBotToken, resolveOpsKnightUser } =
      await import('@/lib/chatops/slash-commands');
    const token = await workspaceBotToken(payload.team_id);
    if (!token) return null;
    const user = await resolveOpsKnightUser(payload.user_id, token, {
      teamId: payload.team_id,
      enterpriseId: payload.enterprise_id || null,
    });
    const view = user ? await buildViewerHome(user.id) : buildUnlinkedHomeView();
    const { callSlackApi } = await import('@/lib/slack/api');
    const result = await callSlackApi(
      'views.publish',
      token,
      { user_id: payload.user_id, view },
      { timeoutMs: 5_000 }
    );
    if (!result.ok) logger.warn('[SlackOps] Home publish failed', { error: result.error });
  } catch (error) {
    // A broken Home tab must never fail or retry the intent worker.
    logger.warn('[SlackOps] Home tab failed', { error: normalizeError(error).code });
  }
  return null;
}

async function buildViewerHome(userId: string) {
  const { resolveUserActor } = await import('@/lib/authorization-actors');
  const { incidentReadWhere, scheduleReadWhere } = await import('@/lib/authorization-filters');
  const { getOnCallNow } = await import('@/lib/oncall-now');
  const { getBaseUrl } = await import('@/lib/env-validation');
  const actor = await resolveUserActor(userId);
  if (!actor) return buildUnlinkedHomeView();
  const select = {
    id: true,
    title: true,
    status: true,
    urgency: true,
    service: { select: { name: true } },
  } as const;
  const openWhere = {
    AND: [
      incidentReadWhere(actor),
      { status: { in: ['OPEN', 'ACKNOWLEDGED'] as Array<'OPEN' | 'ACKNOWLEDGED'> } },
    ],
  };
  const [mine, open, onCall] = await Promise.all([
    prisma.incident.findMany({
      where: { AND: [openWhere, { assigneeId: userId }] },
      select,
      orderBy: { createdAt: 'desc' },
      take: SECTION_LIMIT,
    }),
    prisma.incident.findMany({
      where: { AND: [openWhere, { OR: [{ assigneeId: null }, { assigneeId: { not: userId } }] }] },
      select,
      orderBy: { createdAt: 'desc' },
      take: SECTION_LIMIT,
    }),
    getOnCallNow({
      userId,
      readWhere: scheduleReadWhere(actor),
      scope: 'mine',
      limit: SECTION_LIMIT,
    }).catch(() => null),
  ]);
  return buildHomeView({
    baseUrl: getBaseUrl().replace(/\/+$/, ''),
    onCall: (onCall?.schedules ?? []).filter(row =>
      row.onCall.some(entry => entry.userId === userId)
    ),
    mine,
    open,
  });
}
