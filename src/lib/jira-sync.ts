import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getJiraIssue } from '@/lib/jira';
import { enqueueJiraCommentOperations } from '@/lib/external-operations';
import { enqueueJiraCreateOperation, processExternalOperation } from '@/lib/external-operations';
import { isValidJiraKey, extractJiraKey } from '@/lib/jira-validation';
import { logAudit, getDefaultActorId } from '@/lib/audit';
import { logger } from '@/lib/logger';

export type CreateAndLinkParams = {
  provider?: 'JIRA';
  incidentId?: string;
  actionItemId?: string;
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string | null;
  labels?: string[];
  component?: string | null;
};

export type LinkExistingParams = {
  provider?: 'JIRA';
  incidentId?: string;
  actionItemId?: string;
  jiraKey: string;
};

/**
 * Create a new Jira issue and persist an ExternalIssueLink row.
 * Used by both incident and action-item linking flows.
 */
export async function createJiraIssueAndLink(params: CreateAndLinkParams) {
  const operationId = await enqueueJiraCreateOperation(params);
  const issue = await processExternalOperation(operationId);
  if (!issue) throw new Error('Jira issue creation is already being processed');
  const link = await prisma.externalIssueLink.findUnique({
    where: { provider_externalId: { provider: params.provider ?? 'JIRA', externalId: issue.id } },
  });
  if (!link) throw new Error('Jira issue was created but its durable link is not available yet');

  await logAudit({
    action: 'jira.issue.created',
    entityType: 'SERVICE',
    entityId: params.incidentId ?? params.actionItemId ?? undefined,
    actorId: await getDefaultActorId(),
    details: {
      externalKey: issue.key,
      externalUrl: issue.url,
      incidentId: params.incidentId,
      actionItemId: params.actionItemId,
    },
  });

  return { link, issue };
}

/**
 * Link an existing Jira issue by key. Fetches current status/assignee from
 * Jira and persists the link. Prevents duplicate links.
 */
export async function linkExistingJiraIssue(params: LinkExistingParams) {
  const key = extractJiraKey(params.jiraKey);
  if (!isValidJiraKey(key)) {
    throw new Error(
      `Invalid Jira issue key: "${params.jiraKey}". Expected format like PROJECT-123.`
    );
  }

  // Check for duplicate link
  const existing = await prisma.externalIssueLink.findUnique({
    where: {
      provider_externalKey: {
        provider: params.provider ?? 'JIRA',
        externalKey: key,
      },
    },
  });

  if (existing) {
    throw new Error(`Jira issue ${key} is already linked.`);
  }

  const issue = await getJiraIssue(key);

  const link = await prisma.externalIssueLink.upsert({
    where: {
      provider_externalKey: {
        provider: params.provider ?? 'JIRA',
        externalKey: key,
      },
    },
    create: {
      provider: params.provider ?? 'JIRA',
      incidentId: params.incidentId ?? null,
      actionItemId: params.actionItemId ?? null,
      externalId: issue.id,
      externalKey: issue.key,
      externalUrl: issue.url,
      externalStatus: issue.status ?? null,
      externalAssignee: issue.assignee ?? null,
      syncState: 'SYNCED',
      lastSyncedAt: new Date(),
    },
    update: {
      incidentId: params.incidentId ?? undefined,
      actionItemId: params.actionItemId ?? undefined,
      externalId: issue.id,
      externalUrl: issue.url,
      externalStatus: issue.status ?? null,
      externalAssignee: issue.assignee ?? null,
      syncState: 'SYNCED',
      lastSyncedAt: new Date(),
    },
  });

  await logAudit({
    action: 'jira.issue.linked',
    entityType: 'SERVICE',
    entityId: params.incidentId ?? params.actionItemId ?? undefined,
    actorId: await getDefaultActorId(),
    details: {
      externalKey: issue.key,
      externalUrl: issue.url,
      incidentId: params.incidentId,
      actionItemId: params.actionItemId,
    },
  });

  return { link, issue };
}

/**
 * Re-fetch status and assignee from Jira for a single ExternalIssueLink.
 */
export async function syncExternalIssueLink(linkId: string) {
  const link = await prisma.externalIssueLink.findUnique({
    where: { id: linkId },
  });

  if (!link) throw new Error('External issue link not found.');

  try {
    const issue = await getJiraIssue(link.externalKey);

    return await prisma.externalIssueLink.update({
      where: { id: linkId },
      data: {
        externalStatus: issue.status ?? null,
        externalAssignee: issue.assignee ?? null,
        syncState: 'SYNCED',
        lastSyncedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.externalIssueLink.update({
      where: { id: linkId },
      data: { syncState: 'FAILED' },
    });
    // Intentionally NOT re-throwing: callers that loop over multiple links
    // should not have a single failure abort the entire batch.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webhook processing
// ---------------------------------------------------------------------------

export type JiraWebhookPayload = {
  timestamp?: number | string;
  webhookEvent?: string;
  issue?: {
    id?: string;
    key?: string;
    fields?: {
      status?: { name?: string; statusCategory?: { key?: string } };
      assignee?: { displayName?: string; emailAddress?: string };
      updated?: string;
    };
  };
};

/**
 * Process an inbound Jira webhook event. Finds matching ExternalIssueLink
 * rows by external issue id or key and updates their status/assignee.
 *
 * Idempotent: replay-safe, duplicate events produce the same result.
 */
export async function processJiraWebhookEvent(
  payload: JiraWebhookPayload
): Promise<{ updated: number }> {
  const issueId = payload.issue?.id;
  const issueKey = payload.issue?.key;

  if (!issueId && !issueKey) {
    return { updated: 0 };
  }

  // Find all links that reference this Jira issue
  const links = await prisma.externalIssueLink.findMany({
    where: {
      provider: 'JIRA',
      OR: [
        ...(issueId ? [{ externalId: issueId }] : []),
        ...(issueKey ? [{ externalKey: issueKey }] : []),
      ],
    },
  });

  if (links.length === 0) {
    return { updated: 0 };
  }

  // Discard out-of-order stale webhooks if event timestamp is older than lastSyncedAt
  const eventTime = payload.timestamp
    ? new Date(
        typeof payload.timestamp === 'number' ? payload.timestamp : String(payload.timestamp)
      )
    : payload.issue?.fields?.updated
      ? new Date(payload.issue.fields.updated)
      : null;

  const validLinks =
    eventTime && !isNaN(eventTime.getTime())
      ? links.filter(
          l => !l.lastSyncedAt || l.lastSyncedAt.getTime() <= eventTime.getTime() + 5_000
        )
      : links;

  if (validLinks.length === 0) {
    return { updated: 0 };
  }

  // Only update fields that are actually present in the webhook payload.
  // Jira webhooks often omit unchanged fields — blindly setting them to null
  // would erase valid data stored from a previous sync.
  const data: Record<string, unknown> = {
    syncState: 'SYNCED',
    lastSyncedAt: eventTime && !isNaN(eventTime.getTime()) ? eventTime : new Date(),
  };

  if (payload.issue?.fields && 'status' in payload.issue.fields) {
    data.externalStatus = payload.issue.fields.status?.name ?? null;
  }

  if (payload.issue?.fields && 'assignee' in payload.issue.fields) {
    data.externalAssignee =
      payload.issue.fields.assignee?.displayName ??
      payload.issue.fields.assignee?.emailAddress ??
      null;
  }

  await prisma.externalIssueLink.updateMany({
    where: {
      id: { in: validLinks.map(l => l.id) },
    },
    data,
  });

  const actionItemIds = validLinks.map(l => l.actionItemId).filter(Boolean) as string[];
  if (actionItemIds.length > 0 && data.externalStatus) {
    const isDone =
      payload.issue?.fields?.status?.statusCategory?.key?.toLowerCase() === 'done' ||
      [
        'done',
        'closed',
        'resolved',
        'complete',
        'completed',
        'fixed',
        'deployed',
        'verified',
        'shipped',
      ].includes(String(data.externalStatus).toLowerCase());
    await prisma.$transaction(async tx => {
      await tx.actionItem.updateMany({
        where: {
          id: { in: actionItemIds },
          ...(isDone ? { status: { not: 'COMPLETED' } } : { status: 'COMPLETED' }),
        },
        data: isDone
          ? { status: 'COMPLETED', completedAt: new Date() }
          : { status: 'OPEN', completedAt: null },
      });
      const records = await tx.actionItem.findMany({
        where: { id: { in: actionItemIds } },
        select: { id: true, postmortemId: true, status: true, completedAt: true },
      });
      for (const postmortemId of new Set(records.map(record => record.postmortemId))) {
        const postmortem = await tx.postmortem.findUnique({
          where: { id: postmortemId },
          select: { actionItems: true },
        });
        if (!Array.isArray(postmortem?.actionItems)) continue;
        const byId = new Map(records.map(record => [record.id, record]));
        const synced = postmortem.actionItems.map(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
          const record = byId.get(String((item as Record<string, unknown>).id || ''));
          return record
            ? {
                ...item,
                status: record.status,
                completedAt: record.completedAt?.toISOString() || null,
              }
            : item;
        });
        await tx.postmortem.update({
          where: { id: postmortemId },
          data: { actionItems: synced as Prisma.InputJsonValue },
        });
      }
    });
  }

  return { updated: validLinks.length };
}

/**
 * Post a note/comment from an OpsKnight incident to all linked Jira issues.
 * Best-effort so failures never block OpsKnight operations.
 */
export async function syncIncidentNoteToJira(
  incidentId: string,
  authorName: string,
  noteContent: string
): Promise<number> {
  try {
    const links = await prisma.externalIssueLink.findMany({
      where: { incidentId, provider: 'JIRA' },
      select: { externalKey: true },
    });

    if (links.length === 0) return 0;

    const formattedComment = `[OpsKnight Note by ${authorName}]:\n${noteContent}`;

    const eventId = `note:${Buffer.from(`${authorName}\0${noteContent}`).toString('base64url').slice(0, 96)}`;
    const result = await enqueueJiraCommentOperations(
      links.map(link => ({ incidentId, externalKey: link.externalKey, eventId, comment: formattedComment }))
    );
    return result.pending;
  } catch (error) {
    logger.error('Failed to sync incident note to Jira', {
      component: 'jira-sync',
      incidentId,
      error,
    });
    return 0;
  }
}

/**
 * Post a status update event from an OpsKnight incident to all linked Jira issues.
 */
export async function syncIncidentEventToJira(
  incidentId: string,
  eventMessage: string
): Promise<number> {
  try {
    const links = await prisma.externalIssueLink.findMany({
      where: { incidentId, provider: 'JIRA' },
      select: { externalKey: true },
    });

    if (links.length === 0) return 0;

    const formattedComment = `[OpsKnight Update]: ${eventMessage}`;

    const eventId = `event:${Buffer.from(eventMessage).toString('base64url').slice(0, 96)}`;
    const result = await enqueueJiraCommentOperations(
      links.map(link => ({ incidentId, externalKey: link.externalKey, eventId, comment: formattedComment }))
    );
    return result.pending;
  } catch (error) {
    logger.error('Failed to sync incident event to Jira', {
      component: 'jira-sync',
      incidentId,
      error,
    });
    return 0;
  }
}
