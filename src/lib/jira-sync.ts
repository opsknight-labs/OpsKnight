import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getJiraIssue } from '@/lib/jira';
import {
  enqueueJiraCommentOperations,
  enqueueJiraCreateOperation,
  processExternalOperation,
} from '@/lib/external-operations';
import { isValidJiraKey, extractJiraKey, isJiraStatusDone } from '@/lib/jira-validation';
import { logAudit, getDefaultActorId } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';

function safeRevalidateIncident(incidentId: string): void {
  try {
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    revalidatePath('/');
  } catch {
    // Non-request context (e.g. background worker or test)
  }
}

function safeRevalidateActionItems(incidentIds: Iterable<string> = []): void {
  try {
    revalidatePath('/action-items');
    revalidatePath('/postmortems');
    for (const incidentId of new Set(incidentIds)) {
      revalidatePath(`/postmortems/${incidentId}`);
      revalidatePath(`/incidents/${incidentId}`);
    }
  } catch {
    // Non-request context
  }
}

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

export function extractJiraWebhookStatus(payload: JiraWebhookPayload): {
  statusName?: string;
  statusCategoryKey?: string;
  statusCategoryName?: string;
  isStatusPresent: boolean;
} {
  const fields = payload.issue?.fields;
  let statusName: string | undefined;
  let statusCategoryKey: string | undefined;
  let statusCategoryName: string | undefined;
  let isStatusPresent = false;

  if (fields && 'status' in fields) {
    isStatusPresent = true;
    const rawStatus = fields.status;
    if (typeof rawStatus === 'string') {
      statusName = rawStatus.trim() || undefined;
    } else if (rawStatus && typeof rawStatus === 'object') {
      statusName = (rawStatus as { name?: string }).name?.trim() || undefined;
      const category = (rawStatus as { statusCategory?: { key?: string; name?: string } })
        .statusCategory;
      if (category) {
        statusCategoryKey = category.key?.trim() || undefined;
        statusCategoryName = category.name?.trim() || undefined;
      }
    }
  }

  if (!statusName && payload.changelog?.items && Array.isArray(payload.changelog.items)) {
    const statusItem = payload.changelog.items.find(
      i => i.field?.toLowerCase() === 'status' || i.fieldId?.toLowerCase() === 'status'
    );
    if (statusItem) {
      isStatusPresent = true;
      if (statusItem.toString) {
        statusName = statusItem.toString.trim() || undefined;
      }
    }
  }

  return {
    statusName,
    statusCategoryKey,
    statusCategoryName,
    isStatusPresent,
  };
}

export function extractJiraWebhookAssignee(payload: JiraWebhookPayload): {
  assignee: string | null;
  isAssigneePresent: boolean;
} {
  const fields = payload.issue?.fields;
  let assignee: string | null = null;
  let isAssigneePresent = false;

  if (fields && 'assignee' in fields) {
    isAssigneePresent = true;
    const raw = fields.assignee;
    if (raw === null) {
      assignee = null;
    } else if (typeof raw === 'string') {
      assignee = raw.trim() || null;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as { displayName?: string; emailAddress?: string; name?: string };
      assignee = obj.displayName?.trim() || obj.emailAddress?.trim() || obj.name?.trim() || null;
    }
  }

  if (!isAssigneePresent && payload.changelog?.items && Array.isArray(payload.changelog.items)) {
    const assigneeItem = payload.changelog.items.find(
      i => i.field?.toLowerCase() === 'assignee' || i.fieldId?.toLowerCase() === 'assignee'
    );
    if (assigneeItem) {
      isAssigneePresent = true;
      assignee = assigneeItem.toString?.trim() || null;
    }
  }

  return {
    assignee,
    isAssigneePresent,
  };
}

export type LinkedEntitySyncParams = {
  externalKey: string;
  externalStatus: string;
  isDone: boolean;
  actionItemIds: string[];
  incidentLinks: Array<{
    id: string;
    incidentId: string;
    externalKey: string;
    externalStatus: string | null;
  }>;
};

/**
 * Synchronize action items and incident metadata/timeline when Jira issue status changes.
 */
export async function syncLinkedEntitiesForJiraIssue({
  externalKey: _externalKey,
  externalStatus,
  isDone,
  actionItemIds,
  incidentLinks,
}: LinkedEntitySyncParams): Promise<void> {
  if (actionItemIds.length > 0) {
    const affectedIncidentIds = await prisma.$transaction(async tx => {
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
        select: {
          id: true,
          postmortemId: true,
          incidentId: true,
          status: true,
          completedAt: true,
        },
      });

      for (const postmortemId of new Set(records.map(r => r.postmortemId))) {
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

      return Array.from(new Set(records.map(record => record.incidentId)));
    });

    // Revalidate only after the DB transaction has committed, and use the
    // canonical route key: postmortems are addressed by incidentId, not the
    // internal Postmortem row id.
    safeRevalidateActionItems(affectedIncidentIds);
  }

  if (incidentLinks.length > 0) {
    const actorId = await getDefaultActorId();
    for (const link of incidentLinks) {
      if (!link.incidentId) continue;

      const previousStatus = link.externalStatus;
      const statusChanged =
        previousStatus?.trim().toLowerCase() !== externalStatus.trim().toLowerCase();

      if (statusChanged) {
        const message = isDone
          ? `Jira issue ${link.externalKey} marked as Done (${externalStatus})`
          : `Jira issue ${link.externalKey} status updated to "${externalStatus}"`;

        await prisma.incidentEvent.create({
          data: {
            incidentId: link.incidentId,
            type: 'STATUS_CHANGE',
            message,
          },
        });

        await prisma.incident.update({
          where: { id: link.incidentId },
          data: { updatedAt: new Date() },
        });

        await logAudit({
          action: 'jira.issue.synced',
          entityType: 'INCIDENT',
          entityId: link.incidentId,
          actorId,
          details: {
            externalKey: link.externalKey,
            previousStatus,
            newStatus: externalStatus,
            isDone,
          },
        });

        safeRevalidateIncident(link.incidentId);
      }
    }
  }
}

/**
 * Re-fetch status and assignee from Jira for a single ExternalIssueLink and sync linked entities.
 */
export async function syncExternalIssueLink(linkId: string) {
  const link = await prisma.externalIssueLink.findUnique({
    where: { id: linkId },
    include: {
      incident: {
        select: {
          service: {
            select: {
              jiraServiceMapping: {
                select: { syncEnabled: true },
              },
            },
          },
        },
      },
      actionItem: {
        select: {
          incident: {
            select: {
              service: {
                select: {
                  jiraServiceMapping: {
                    select: { syncEnabled: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!link) throw new Error('External issue link not found.');

  const mapping =
    link.incident?.service?.jiraServiceMapping ??
    link.actionItem?.incident?.service?.jiraServiceMapping;
  if (mapping?.syncEnabled === false) {
    throw new Error(
      'Jira metadata sync is disabled for this service. Enable it in Service Settings → Jira Mapping.'
    );
  }

  try {
    const issue = await getJiraIssue(link.externalKey);
    const newStatus = issue.status ?? null;
    const newAssignee = issue.assignee ?? null;

    const updated = await prisma.externalIssueLink.update({
      where: { id: linkId },
      data: {
        externalStatus: newStatus,
        externalAssignee: newAssignee,
        syncState: 'SYNCED',
        lastSyncedAt: new Date(),
      },
    });

    if (newStatus) {
      const isDone = isJiraStatusDone(newStatus, issue.statusCategoryKey, issue.statusCategoryName);
      await syncLinkedEntitiesForJiraIssue({
        externalKey: link.externalKey,
        externalStatus: newStatus,
        isDone,
        actionItemIds: link.actionItemId ? [link.actionItemId] : [],
        incidentLinks: link.incidentId
          ? [
              {
                id: link.id,
                incidentId: link.incidentId,
                externalKey: link.externalKey,
                externalStatus: link.externalStatus,
              },
            ]
          : [],
      });
    }

    return updated;
  } catch (_error) {
    await prisma.externalIssueLink.update({
      where: { id: linkId },
      data: { syncState: 'FAILED' },
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webhook processing
// ---------------------------------------------------------------------------

export type JiraWebhookPayload = {
  timestamp?: number | string;
  webhookEvent?: string;
  issue_event_type_name?: string;
  issue?: {
    id?: string;
    key?: string;
    fields?: {
      status?:
        | string
        | {
            name?: string;
            statusCategory?: {
              id?: number;
              key?: string;
              name?: string;
              colorName?: string;
            };
          };
      assignee?:
        | string
        | {
            displayName?: string;
            emailAddress?: string;
            name?: string;
          }
        | null;
      updated?: string;
      [key: string]: unknown;
    };
  };
  changelog?: {
    id?: string;
    items?: Array<{
      field?: string;
      fieldId?: string;
      fromString?: string | null;
      toString?: string | null;
      from?: string | null;
      to?: string | null;
    }>;
  };
  [key: string]: unknown;
};

/**
 * Process an inbound Jira webhook event. Finds matching ExternalIssueLink
 * rows by external issue id or key and updates their status/assignee,
 * syncing incidents and action items.
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

  const normalizedKey = issueKey ? extractJiraKey(issueKey) : undefined;
  const keyCandidates = Array.from(
    new Set(
      [issueKey, normalizedKey, issueKey?.toUpperCase(), issueKey?.toLowerCase()].filter(
        Boolean
      ) as string[]
    )
  );

  const links = await prisma.externalIssueLink.findMany({
    where: {
      provider: 'JIRA',
      OR: [
        ...(issueId ? [{ externalId: issueId }] : []),
        ...keyCandidates.map(k => ({ externalKey: k })),
      ],
    },
  });

  if (links.length === 0) {
    return { updated: 0 };
  }

  const linkIds = links.map(l => l.id);
  const linksWithSyncEnabled = await prisma.externalIssueLink.findMany({
    where: { id: { in: linkIds } },
    include: {
      incident: {
        select: {
          service: {
            select: {
              jiraServiceMapping: {
                select: { syncEnabled: true },
              },
            },
          },
        },
      },
      actionItem: {
        select: {
          incident: {
            select: {
              service: {
                select: {
                  jiraServiceMapping: {
                    select: { syncEnabled: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const syncableLinkIds = new Set(
    linksWithSyncEnabled
      .filter(link => {
        const mapping =
          link.incident?.service?.jiraServiceMapping ??
          link.actionItem?.incident?.service?.jiraServiceMapping;
        return mapping?.syncEnabled !== false;
      })
      .map(link => link.id)
  );

  const syncableLinks = links.filter(l => syncableLinkIds.has(l.id));

  if (syncableLinks.length === 0) {
    return { updated: 0 };
  }

  const { statusName, statusCategoryKey, statusCategoryName, isStatusPresent } =
    extractJiraWebhookStatus(payload);
  const { assignee, isAssigneePresent } = extractJiraWebhookAssignee(payload);

  const eventTime = payload.timestamp
    ? new Date(
        typeof payload.timestamp === 'number' ? payload.timestamp : String(payload.timestamp)
      )
    : payload.issue?.fields?.updated
      ? new Date(payload.issue.fields.updated)
      : null;

  const validLinks =
    eventTime && !isNaN(eventTime.getTime())
      ? syncableLinks.filter(l => {
          if (!l.lastSyncedAt) return true;
          if (
            statusName &&
            statusName.trim().toLowerCase() !== (l.externalStatus || '').trim().toLowerCase()
          ) {
            return true;
          }
          return l.lastSyncedAt.getTime() <= eventTime.getTime() + 300_000;
        })
      : syncableLinks;

  if (validLinks.length === 0) {
    return { updated: 0 };
  }

  const data: Record<string, unknown> = {
    syncState: 'SYNCED',
    lastSyncedAt: eventTime && !isNaN(eventTime.getTime()) ? eventTime : new Date(),
  };

  if (isStatusPresent) {
    data.externalStatus = statusName ?? null;
  }

  if (isAssigneePresent) {
    data.externalAssignee = assignee;
  }

  await prisma.externalIssueLink.updateMany({
    where: {
      id: { in: validLinks.map(l => l.id) },
    },
    data,
  });

  if (isStatusPresent && statusName) {
    const isDone = isJiraStatusDone(statusName, statusCategoryKey, statusCategoryName);
    const actionItemIds = validLinks.map(l => l.actionItemId).filter(Boolean) as string[];
    const incidentLinks = validLinks
      .filter(l => Boolean(l.incidentId))
      .map(l => ({
        id: l.id,
        incidentId: l.incidentId!,
        externalKey: l.externalKey,
        externalStatus: l.externalStatus,
      }));

    await syncLinkedEntitiesForJiraIssue({
      externalKey: issueKey || validLinks[0].externalKey,
      externalStatus: statusName,
      isDone,
      actionItemIds,
      incidentLinks,
    });
  }

  // Assignee-only webhooks must invalidate the same surfaces as status changes.
  // Resolve action-item parent incident ids because postmortem routes are keyed
  // by incident id and inherited incident/action-item Jira badges live there.
  const directIncidentIds = validLinks.map(link => link.incidentId).filter(Boolean) as string[];
  for (const incidentId of new Set(directIncidentIds)) safeRevalidateIncident(incidentId);

  const actionItemIds = validLinks.map(link => link.actionItemId).filter(Boolean) as string[];
  if (actionItemIds.length > 0) {
    const actionItemParents = await prisma.actionItem.findMany({
      where: { id: { in: actionItemIds } },
      select: { incidentId: true },
    });
    safeRevalidateActionItems(actionItemParents.map(item => item.incidentId));
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
  noteContent: string,
  noteId: string
): Promise<number> {
  try {
    const links = await prisma.externalIssueLink.findMany({
      where: { incidentId, provider: 'JIRA' },
      select: { externalKey: true },
    });

    if (links.length === 0) return 0;

    const formattedComment = `[OpsKnight Note by ${authorName}]:\n${noteContent}`;

    const eventId = `note:${noteId}`;
    const result = await enqueueJiraCommentOperations(
      links.map(link => ({
        incidentId,
        externalKey: link.externalKey,
        eventId,
        comment: formattedComment,
      }))
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
  eventMessage: string,
  incidentEventId: string
): Promise<number> {
  try {
    const links = await prisma.externalIssueLink.findMany({
      where: { incidentId, provider: 'JIRA' },
      select: { externalKey: true },
    });

    if (links.length === 0) return 0;

    const formattedComment = `[OpsKnight Update]: ${eventMessage}`;

    const eventId = `event:${incidentEventId}`;
    const result = await enqueueJiraCommentOperations(
      links.map(link => ({
        incidentId,
        externalKey: link.externalKey,
        eventId,
        comment: formattedComment,
      }))
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
