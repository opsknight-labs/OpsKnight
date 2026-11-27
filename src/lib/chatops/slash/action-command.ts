/**
 * `/incident action <text> [@person] [due:YYYY-MM-DD]` and `/incident actions`.
 *
 * Action items live on a postmortem, so the first one creates the incident's DRAFT postmortem through the
 * same command as `/incident postmortem` (never a second one) and then appends through the same
 * replace command the API uses, under the same edit rules.
 */
import { runSerializableTransaction } from '@/lib/db-utils';
import prisma from '@/lib/prisma';
import { escapeSlack } from '@/lib/chatops/squire/render';
import { getBaseUrl } from '@/lib/env-validation';
import { resolveUserActor } from '@/lib/authorization-actors';
import { authorizeChatOpsIncident } from '@/lib/incidents/chatops-lifecycle';
import { executeChatOpsPostmortemCommand } from '@/lib/incidents/chatops-postmortem';
import { assertPostmortemAccess, postmortemEditWhere } from '@/lib/postmortems/authorization';
import {
  getPostmortemActionItems,
  replacePostmortemActionItems,
} from '@/lib/postmortems/action-item-commands';

export const ACTION_TITLE_MAX = 200;
export const ACTION_LIST_MAX = 10;
const DAY_MS = 86_400_000;
const MENTION = /<@([UW][A-Z0-9]{1,20})[^>]{0,80}>/g;

export const ACTION_USAGE = 'Usage: `/incident action <what to do> [@person] [due:YYYY-MM-DD]`';

export type ParsedAction =
  | { ok: true; title: string; ownerSlackId: string | null; dueDate: string | null }
  | { ok: false; error: string };

export function parseActionArgs(args: string, now: Date = new Date()): ParsedAction {
  let rest = args;
  let dueDate: string | null = null;
  const due = /(?:^|\s)due:(\S*)/i.exec(rest);
  if (due) {
    const value = due[1];
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      return { ok: false, error: 'The due date must be a real date written as `due:YYYY-MM-DD`.' };
    }
    if (parsed.getTime() < now.getTime() - DAY_MS) {
      return { ok: false, error: 'The due date is in the past.' };
    }
    dueDate = value;
    rest = rest.replace(due[0], ' ');
  }
  const owners = [...new Set([...rest.matchAll(MENTION)].map(match => match[1]))];
  if (owners.length > 1) return { ok: false, error: 'Mention at most one owner.' };
  const title = rest.replace(MENTION, ' ').replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, error: ACTION_USAGE };
  if (title.length > ACTION_TITLE_MAX) {
    return { ok: false, error: `Keep the action under ${ACTION_TITLE_MAX} characters.` };
  }
  return { ok: true, title, ownerSlackId: owners[0] ?? null, dueDate };
}

type Reply = { response_type: 'in_channel' | 'ephemeral'; text: string };
const refuse = (text: string): Reply => ({ response_type: 'ephemeral', text: `⚠️ ${text}` });

export async function handleActionCommand(input: {
  incident: { id: string; title: string };
  actor: { id: string; name: string };
  args: string;
  channelName: string;
  /** Resolves a mentioned Slack user to an OpsKnight user (null when not linked). */
  resolveOwner: (slackUserId: string) => Promise<{ id: string; name: string } | null>;
  idempotency?: { key: string; principalId: string };
  now?: Date;
}): Promise<Reply> {
  const parsed = parseActionArgs(input.args, input.now);
  if (!parsed.ok) return refuse(parsed.error);
  const owner = parsed.ownerSlackId ? await input.resolveOwner(parsed.ownerSlackId) : null;
  if (parsed.ownerSlackId && !owner) {
    return refuse(
      `<@${parsed.ownerSlackId}> is not linked to an active OpsKnight account, so the action was not created.`
    );
  }
  const actorForAccess = await resolveUserActor(input.actor.id);
  if (!actorForAccess) return refuse('Your OpsKnight account is not active.');

  // Gets or creates the one DRAFT postmortem (also checks MANAGE on the incident).
  const postmortemResult = await executeChatOpsPostmortemCommand({
    incidentId: input.incident.id,
    actor: input.actor,
    channelName: input.channelName,
    ...(input.idempotency ? { idempotency: input.idempotency } : {}),
  });
  const postmortem = await prisma.postmortem.findUnique({
    where: { incidentId: input.incident.id },
    select: { id: true },
  });
  if (!postmortem) return refuse('Could not find the postmortem for this incident.');

  const outcome = await runSerializableTransaction(async tx => {
    await assertPostmortemAccess(tx, postmortem.id, postmortemEditWhere(actorForAccess));
    const current = await getPostmortemActionItems(tx, postmortem.id);
    if (current.items.some(item => item.status !== 'COMPLETED' && item.title === parsed.title)) {
      return { duplicate: true as const };
    }
    if (current.items.length >= 100) return { full: true as const };
    const beforeIds = new Set(current.items.map(item => item.id));
    const result = await replacePostmortemActionItems(tx, postmortem.id, current.revision, [
      ...current.items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description ?? '',
        ownerId: item.owner ?? null,
        dueDate: item.dueDate ?? null,
        status: item.status,
        priority: item.priority,
      })),
      {
        title: parsed.title,
        description: `Added from Slack by ${input.actor.name}`,
        ownerId: owner?.id ?? null,
        dueDate: parsed.dueDate,
        status: 'OPEN' as const,
        priority: 'MEDIUM' as const,
      },
    ]);
    const created = result.items.find(item => !beforeIds.has(item.id));
    if (created) {
      await tx.actionItem.update({ where: { id: created.id }, data: { source: 'MANUAL' } });
    }
    return { duplicate: false as const, full: false as const };
  });

  if ('duplicate' in outcome && outcome.duplicate) {
    return refuse('An open action item with the same text already exists.');
  }
  if ('full' in outcome && outcome.full)
    return refuse('This postmortem already has 100 action items.');
  const url = `${getBaseUrl()}/postmortems/${input.incident.id}`;
  return {
    response_type: 'in_channel',
    text: `✅ *Action item added* by ${escapeSlack(input.actor.name)}${
      postmortemResult.created ? ' (postmortem draft created)' : ''
    }\n• ${escapeSlack(parsed.title)}${owner ? ` — owner *${escapeSlack(owner.name)}*` : ''}${
      parsed.dueDate ? ` — due ${parsed.dueDate}` : ''
    }\n🔗 ${url}`,
  };
}

export async function handleActionsListCommand(input: {
  incident: { id: string };
  actor: { id: string };
}): Promise<Reply> {
  await authorizeChatOpsIncident(input.incident.id, input.actor.id, 'READ');
  const where = {
    incidentId: input.incident.id,
    status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] as Array<'OPEN' | 'IN_PROGRESS' | 'BLOCKED'> },
  };
  const [rows, total] = await Promise.all([
    prisma.actionItem.findMany({
      where,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: ACTION_LIST_MAX,
      select: { title: true, dueDate: true, status: true, owner: { select: { name: true } } },
    }),
    prisma.actionItem.count({ where }),
  ]);
  if (rows.length === 0) {
    return { response_type: 'ephemeral', text: 'No open action items for this incident.' };
  }
  const lines = rows.map(
    row =>
      `• ${escapeSlack(row.title)}${row.owner ? ` — ${escapeSlack(row.owner.name ?? '')}` : ''}${
        row.dueDate ? ` — due ${row.dueDate.toISOString().slice(0, 10)}` : ''
      }${row.status === 'BLOCKED' ? ' (blocked)' : ''}`
  );
  const more = total > rows.length ? `\n…and ${total - rows.length} more in OpsKnight.` : '';
  return {
    response_type: 'ephemeral',
    text: `*Open action items (${total})*\n${lines.join('\n')}${more}`,
  };
}
