import 'server-only';
import type { Prisma, Role } from '@prisma/client';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { APP_ROLES, CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationAction,
} from '@/lib/authorization-policy';

/**
 * In-app notifications for MCP approvals. In-app only, by owner decision: email would reach every
 * administrator. Rows are written in the caller's transaction, so a request that rolls back never
 * notifies anyone, and the deterministic dedupe key keeps a retried prepare from notifying twice.
 */

/** Notifications link here; the notification APIs map this entity type to the review page. */
export const MCP_APPROVAL_ENTITY_TYPE = 'MCP_APPROVAL';
/** At most this many reviewers are notified about one request. */
export const MCP_APPROVAL_NOTIFY_LIMIT = 50;

const approvalKey = (id: string) => `mcp-approval:${id}`;

/** Reviewer call-to-action titles; the requester's decision notice uses different ones. */
export const OPERATION_REVIEW_TITLE = 'Change waiting for your review';
export const RUNBOOK_REVIEW_TITLE = 'Runbook run waiting for your review';

const RESOLVED_MESSAGE = new Map([
  ['approve', 'Another reviewer approved this request. Nothing is waiting for you.'],
  ['reject', 'Another reviewer rejected this request. Nothing is waiting for you.'],
  ['expire', 'This request expired before it was used. Nothing is waiting for you.'],
] as const);

/** Untrusted names (a self-registered assistant chooses its own) are quoted and shortened. */
function quoted(value: string | null | undefined, max = 60) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;
}

function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hours`;
}

async function requesterLine(tx: Prisma.TransactionClient, actorId: string, grantId: string) {
  const [grant, user] = await Promise.all([
    tx.mcpGrant.findUnique({
      where: { id: grantId },
      select: { userId: true, client: { select: { name: true } } },
    }),
    tx.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } }),
  ]);
  const who = user?.name ?? user?.email ?? 'A user';
  const via = grant?.userId === actorId ? quoted(grant.client.name) : null;
  return via ? `${who} asked the assistant ${via}` : `${who} asked an assistant`;
}

type Candidate = {
  id: string;
  role: string;
  status: string;
  teamMemberships: { teamId: string }[];
};

/** Active users in the given roles, excluding the requester: one bounded query. */
function candidates(tx: Prisma.TransactionClient, roles: string[], requesterId: string) {
  return tx.user.findMany({
    where: { role: { in: roles as Role[] }, status: 'ACTIVE', id: { not: requesterId } },
    orderBy: { id: 'asc' },
    take: MCP_APPROVAL_NOTIFY_LIMIT,
    select: { id: true, role: true, status: true, teamMemberships: { select: { teamId: true } } },
  }) as Promise<Candidate[]>;
}

/** Administrators who could approve this operation, never the requester. */
export async function operationReviewerIds(
  tx: Prisma.TransactionClient,
  input: { actorId: string; authorizationActions: readonly AuthorizationAction[] }
) {
  // Operation review always requires an administrator holding every action of the operation.
  const users = await candidates(tx, ['ADMIN'], input.actorId);
  return users
    .map(authorizationActorFromUser)
    .filter(
      actor =>
        actor?.role === 'ADMIN' &&
        input.authorizationActions.length > 0 &&
        input.authorizationActions.every(action => authorize({ actor, action }).allowed)
    )
    .map(actor => actor!.id);
}

/**
 * Users who could approve this runbook run: they hold runbook approval and read and can see the
 * plan's incident and service. Roles are taken from the capability table, so a role change there
 * changes who is notified. A reviewer whose incident or service visibility is team-scoped is not
 * notified for a targeted plan, because that cannot be decided without a query per person; the
 * request is still reviewable by them from the link.
 */
export async function runbookReviewerIds(
  tx: Prisma.TransactionClient,
  input: { actorId: string; incidentId: string | null; serviceId: string | null }
) {
  const roles = APP_ROLES.filter(role => hasCapability(role, CAPABILITIES.RUNBOOK_APPROVE));
  const users = await candidates(tx, roles, input.actorId);
  const global = (
    actor: NonNullable<ReturnType<typeof authorizationActorFromUser>>,
    action: AuthorizationAction
  ) => {
    const decision = authorize({ actor, action });
    return decision.allowed && decision.scope === 'global';
  };
  return users
    .map(authorizationActorFromUser)
    .filter(
      (actor): actor is NonNullable<typeof actor> =>
        actor !== null &&
        authorize({ actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE }).allowed &&
        authorize({ actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_READ }).allowed &&
        (!input.incidentId || global(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ)) &&
        (!input.serviceId || global(actor, AUTHORIZATION_ACTIONS.SERVICE_READ))
    )
    .map(actor => actor.id);
}

/** Tells eligible reviewers that a change is waiting. The frozen request is never included. */
export async function notifyOperationReviewers(
  tx: Prisma.TransactionClient,
  input: {
    approvalId: string;
    actorId: string;
    grantId: string;
    summary: string;
    authorizationActions: readonly AuthorizationAction[];
    expiresAt: Date;
  }
) {
  const userIds = await operationReviewerIds(tx, input);
  if (!userIds.length) return [];
  const who = await requesterLine(tx, input.actorId, input.grantId);
  await createInAppNotifications(
    {
      userIds,
      type: 'SYSTEM',
      title: OPERATION_REVIEW_TITLE,
      message: `${who} to: ${input.summary}. Review it within ${duration(input.expiresAt.getTime() - Date.now())}.`,
      entityType: MCP_APPROVAL_ENTITY_TYPE,
      entityId: input.approvalId,
      dedupeKey: approvalKey(input.approvalId),
    },
    tx
  );
  return userIds;
}

export async function notifyRunbookReviewers(
  tx: Prisma.TransactionClient,
  input: {
    previewId: string;
    actorId: string;
    grantId: string;
    runbookId: string;
    incidentId: string | null;
    serviceId: string | null;
    expiresAt: Date;
  }
) {
  const userIds = await runbookReviewerIds(tx, input);
  if (!userIds.length) return [];
  const [who, runbook] = await Promise.all([
    requesterLine(tx, input.actorId, input.grantId),
    tx.runbook.findUnique({ where: { id: input.runbookId }, select: { name: true } }),
  ]);
  await createInAppNotifications(
    {
      userIds,
      type: 'SYSTEM',
      title: RUNBOOK_REVIEW_TITLE,
      message: `${who} to run ${quoted(runbook?.name, 80) ?? 'a runbook'}. Review it within ${duration(input.expiresAt.getTime() - Date.now())}.`,
      entityType: MCP_APPROVAL_ENTITY_TYPE,
      entityId: input.previewId,
      dedupeKey: approvalKey(input.previewId),
    },
    tx
  );
  return userIds;
}

/** Tells the requester the outcome; skipped when they decided it themselves. */
export async function notifyRequesterOfDecision(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    requesterId: string;
    reviewerId: string;
    kind: 'operation' | 'runbook';
    decision: 'approve' | 'reject';
    commitDeadline?: Date | null;
  }
) {
  if (input.requesterId === input.reviewerId) return;
  const what = input.kind === 'operation' ? 'change' : 'runbook run';
  const approved = input.decision === 'approve';
  await createInAppNotifications(
    {
      userIds: [input.requesterId],
      type: 'SYSTEM',
      title: approved ? `Your ${what} was approved` : `Your ${what} was rejected`,
      message: approved
        ? `Ask your assistant to continue${input.commitDeadline ? ` within ${duration(input.commitDeadline.getTime() - Date.now())}` : ''}; it can apply the approved ${what} once.`
        : `Nothing was changed. Open the request to see the reviewer's note, then ask your assistant to prepare it again if needed.`,
      entityType: MCP_APPROVAL_ENTITY_TYPE,
      entityId: input.id,
      dedupeKey: `${approvalKey(input.id)}:decision`,
    },
    tx
  );
}

/**
 * Closes the other reviewers' unread calls to action once a request is decided or lapses, in the
 * caller's transaction. Only the reviewer titles match, so the requester's decision notice (same
 * entity) stays unread.
 */
export async function resolveReviewerNotices(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
  outcome: 'approve' | 'reject' | 'expire',
  now = new Date()
) {
  if (!ids.length) return 0;
  const resolved = await tx.inAppNotification.updateMany({
    where: {
      entityType: MCP_APPROVAL_ENTITY_TYPE,
      entityId: { in: [...ids] },
      readAt: null,
      title: { in: [OPERATION_REVIEW_TITLE, RUNBOOK_REVIEW_TITLE] },
    },
    data: { readAt: now, message: RESOLVED_MESSAGE.get(outcome)! },
  });
  return resolved.count;
}
