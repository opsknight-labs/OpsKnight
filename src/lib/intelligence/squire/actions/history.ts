import 'server-only';
import { z } from 'zod/v4';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { CAPABILITIES } from '@/lib/authorization';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { ACTION_OUTCOME_STATES, UNKNOWN_ACTION_MESSAGE, type SquireActionStatus } from './outcomes';

export const ACTION_HISTORY_PAGE_SIZE = 50;
/** Same cut-off as outcomes.ts: a receipt still "running" after this is reported UNKNOWN. */
const STALE_MS = 120_000;

export type ActionHistoryScope = 'mine' | 'everyone';
export interface ActionHistoryRow {
  id: string;
  at: string;
  /** Who confirmed it; only in the everyone view. */
  who?: string;
  action: string;
  status: SquireActionStatus;
  message: string;
  href?: string;
}
export interface ActionHistoryPage {
  rows: ActionHistoryRow[];
  nextCursor: string | null;
  scope: ActionHistoryScope;
  canSeeEveryone: boolean;
}

// Only the outcome message is read back; the intent (arguments) is never decrypted here.
const resultSchema = z.object({ ok: z.boolean(), message: z.string().max(2_000) });

/** The same per-status wording outcomes.ts falls back to when no result message can be read. */
function genericMessage(status: SquireActionStatus): string {
  if (status === 'SUCCEEDED')
    return 'The action completed. Open the incident to review the result.';
  if (status === 'FAILED')
    return 'The action did not complete. Review the incident before requesting a new suggestion.';
  if (status === 'UNKNOWN') return UNKNOWN_ACTION_MESSAGE;
  return 'This action has not reported a result yet. Check its result; do not submit it again.';
}

export const canSeeEveryonesActions = (actor: AuthorizationActor) =>
  actorHasCapability(actor, CAPABILITIES.INTELLIGENCE_MANAGE);

function canUseHistory(actor: AuthorizationActor) {
  return (
    !actor.apiKey &&
    actor.status === 'ACTIVE' &&
    actorHasCapability(actor, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)
  );
}

export function actionLabel(action: string): string {
  if (action.startsWith('operation:')) {
    const id = action.slice('operation:'.length);
    return MCP_OPERATION_MAP.get(id)?.summary ?? id;
  }
  // Multi-step plans (plans.ts) record `plan:<n> steps`.
  const plan = /^plan:(\d+) steps$/.exec(action);
  if (plan) return `Plan of ${plan[1]} steps`;
  const words = action.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusWhere(
  status: SquireActionStatus | undefined,
  now: Date
): Prisma.SquireActionReceiptWhereInput {
  if (!status) return {};
  const cutoff = new Date(now.getTime() - STALE_MS);
  const live = ['RESERVED', 'RUNNING'];
  const stale: Prisma.SquireActionReceiptWhereInput = {
    status: { in: live },
    OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
  };
  if (status === 'UNKNOWN') return { OR: [{ status: 'UNKNOWN' }, stale] };
  if (status === 'RESERVED' || status === 'RUNNING') return { status, NOT: stale };
  return { status };
}

function effectiveStatus(
  receipt: { status: string; startedAt: Date | null; createdAt: Date },
  now: Date
): SquireActionStatus {
  const status = ACTION_OUTCOME_STATES.find(state => state === receipt.status) ?? 'UNKNOWN';
  if (
    (status === 'RESERVED' || status === 'RUNNING') &&
    now.getTime() - (receipt.startedAt ?? receipt.createdAt).getTime() > STALE_MS
  )
    return 'UNKNOWN';
  return status;
}

async function resultMessage(
  encrypted: string | null,
  status: SquireActionStatus
): Promise<string | null> {
  if (!encrypted || (status !== 'SUCCEEDED' && status !== 'FAILED')) return null;
  try {
    const parsed = resultSchema.safeParse(JSON.parse(await decrypt(encrypted)));
    return parsed.success && parsed.data.ok === (status === 'SUCCEEDED')
      ? parsed.data.message
      : null;
  } catch {
    return null; // A retired key must not invent an outcome.
  }
}

/**
 * Receipts of confirmed Squire actions, newest first. The viewer sees their own; an intelligence
 * manager may see everyone's. A row about an incident the viewer can no longer read is left out
 * entirely, so its outcome text (which may name the incident) is never shown. Only the person who
 * confirmed an action sees its stored outcome text (it can quote record names and values); everyone
 * else sees the per-status wording.
 */
export async function listSquireActionHistory(
  actor: AuthorizationActor,
  options: { scope?: string; status?: string; cursor?: string } = {},
  now: Date = new Date()
): Promise<ActionHistoryPage | null> {
  if (!canUseHistory(actor)) return null;
  const canSeeEveryone = canSeeEveryonesActions(actor);
  const scope: ActionHistoryScope =
    options.scope === 'everyone' && canSeeEveryone ? 'everyone' : 'mine';
  const status = ACTION_OUTCOME_STATES.find(state => state === options.status);
  const cursor = z.string().uuid().safeParse(options.cursor).success ? options.cursor : undefined;

  const fetched = await prisma.squireActionReceipt.findMany({
    where: {
      AND: [
        scope === 'mine' ? { userId: actor.id } : {},
        // Only the shapes Squire writes; anything else is not ours to describe.
        {
          OR: [
            { incidentId: { not: null } },
            { action: { startsWith: 'operation:' } },
            { action: { startsWith: 'plan:' } },
          ],
        },
        statusWhere(status, now),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // No `skip: 1`: the cursor row may not match this filter, so it is dropped by id below.
    take: ACTION_HISTORY_PAGE_SIZE + 2,
    ...(cursor ? { cursor: { id: cursor } } : {}),
    select: {
      id: true,
      userId: true,
      action: true,
      incidentId: true,
      status: true,
      resultEncrypted: true,
      startedAt: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  const receipts = fetched.filter(receipt => receipt.id !== cursor);
  const page = receipts.slice(0, ACTION_HISTORY_PAGE_SIZE);
  const nextCursor = receipts.length > ACTION_HISTORY_PAGE_SIZE ? page[page.length - 1]!.id : null;

  const incidentIds = [...new Set(page.flatMap(r => (r.incidentId ? [r.incidentId] : [])))];
  let readable = new Set<string>();
  if (incidentIds.length) {
    try {
      const rows = await prisma.incident.findMany({
        where: { AND: [{ id: { in: incidentIds } }, incidentReadWhere(actor)] },
        select: { id: true },
      });
      readable = new Set(rows.map(row => row.id));
    } catch {
      /* No incident scope for this actor: every incident row stays hidden. */
    }
  }

  const rows: ActionHistoryRow[] = [];
  for (const receipt of page) {
    if (receipt.incidentId && !readable.has(receipt.incidentId)) continue;
    const rowStatus = effectiveStatus(receipt, now);
    rows.push({
      id: receipt.id,
      at: receipt.createdAt.toISOString(),
      ...(scope === 'everyone' ? { who: receipt.user.name ?? receipt.user.email } : {}),
      action: actionLabel(receipt.action),
      status: rowStatus,
      message:
        (receipt.userId === actor.id
          ? await resultMessage(receipt.resultEncrypted, rowStatus)
          : null) ?? genericMessage(rowStatus),
      ...(receipt.incidentId ? { href: `/incidents/${receipt.incidentId}` } : {}),
    });
  }
  return { rows, nextCursor, scope, canSeeEveryone };
}
