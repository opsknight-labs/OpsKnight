'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdminOrResponder } from '@/lib/rbac';
import {
  createJiraIssueAndLink,
  linkExistingJiraIssue,
  syncExternalIssueLink,
} from '@/lib/jira-sync';
import {
  classifyJiraError,
  getJiraCapabilities,
  type JiraCapability,
} from '@/lib/jira-capabilities';
import {
  acquireJiraActionItemLinkFence,
  acquireJiraWorkspaceProviderFence,
  JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
  JIRA_PROVIDER_FENCE_TIMEOUT_MS,
} from '@/lib/jira-concurrency';
import type { ActionItemExternalIssue } from '@/lib/action-items';
import { revalidatePath } from 'next/cache';

export type JiraActionResult = {
  success: boolean;
  error?: string;
  key?: string;
  url?: string;
  externalIssue?: ActionItemExternalIssue;
};

type JiraLinkProjection = {
  id: string;
  provider: string;
  externalKey: string;
  externalUrl: string;
  externalStatus: string | null;
  externalAssignee: string | null;
  syncState: string;
};

const EntityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid identifier.');

const CreateActionItemJiraSchema = z
  .object({ actionItemId: EntityIdSchema })
  .strict();

const LinkActionItemJiraSchema = z
  .object({
    actionItemId: EntityIdSchema,
    jiraKey: z.string().trim().min(1).max(255),
  })
  .strict();

const OwnedActionItemJiraSchema = z
  .object({
    actionItemId: EntityIdSchema,
    linkId: EntityIdSchema,
  })
  .strict();

const fencedTransactionOptions = {
  maxWait: JIRA_PROVIDER_FENCE_MAX_WAIT_MS,
  timeout: JIRA_PROVIDER_FENCE_TIMEOUT_MS,
};

class ActionItemJiraLinkChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionItemJiraLinkChangedError';
  }
}

function validationFailure(): JiraActionResult {
  return { success: false, error: 'Invalid Jira action request.' };
}

function toActionItemExternalIssue(link: JiraLinkProjection): ActionItemExternalIssue {
  return {
    linkId: link.id,
    provider: link.provider,
    key: link.externalKey,
    url: link.externalUrl,
    status: link.externalStatus ?? undefined,
    assignee: link.externalAssignee ?? undefined,
    syncState: link.syncState,
  };
}

function revalidateActionItemPaths(incidentId?: string | null) {
  if (incidentId) {
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath(`/postmortems/${incidentId}`);
  }
  revalidatePath('/action-items');
  revalidatePath('/postmortems');
}

function alreadyLinkedError(externalKey: string): JiraActionResult {
  return {
    success: false,
    error: `This action item is already linked to Jira issue ${externalKey}. Refresh the page to see the current link.`,
  };
}

function capabilityFailure(
  capability: JiraCapability,
  operation: 'create' | 'link' | 'sync' | 'unlink'
): JiraActionResult {
  if (capability.workspaceState === 'NOT_CONFIGURED') {
    return { success: false, error: 'Jira is not configured in workspace settings.' };
  }
  if (capability.workspaceState !== 'ENABLED') {
    return { success: false, error: 'Jira is disabled or not fully configured in workspace settings.' };
  }
  if (operation === 'create' && !capability.serviceMapped) {
    return {
      success: false,
      error: 'Configure a Jira project for this service in Service Settings first.',
    };
  }
  if (operation === 'sync' && !capability.syncEnabled) {
    return {
      success: false,
      error: 'Jira metadata sync is disabled for this service.',
    };
  }
  return { success: false, error: `Jira ${operation} is not allowed for this action item.` };
}

async function currentActionItemJiraLink(actionItemId: string) {
  return prisma.externalIssueLink.findFirst({
    where: { provider: 'JIRA', actionItemId },
    select: { externalKey: true },
  });
}

export async function createJiraIssueFromActionItem(
  actionItemIdInput: string
): Promise<JiraActionResult> {
  const parsed = CreateActionItemJiraSchema.safeParse({ actionItemId: actionItemIdInput });
  if (!parsed.success) return validationFailure();
  const { actionItemId } = parsed.data;

  try {
    await assertAdminOrResponder();

    const actionItem = await prisma.actionItem.findUnique({
      where: { id: actionItemId },
      select: {
        id: true,
        title: true,
        description: true,
        incidentId: true,
        externalIssueLinks: {
          where: { provider: 'JIRA' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { externalKey: true },
        },
        incident: {
          select: {
            service: {
              select: {
                id: true,
                jiraServiceMapping: true,
              },
            },
          },
        },
      },
    });

    if (!actionItem) return { success: false, error: 'Action item not found.' };

    const existingLink = actionItem.externalIssueLinks[0];
    if (existingLink) return alreadyLinkedError(existingLink.externalKey);

    const serviceId = actionItem.incident?.service?.id ?? null;
    const capability = await getJiraCapabilities({ serviceId, canManage: true });
    if (!capability.canCreate) return capabilityFailure(capability, 'create');

    const mapping = actionItem.incident?.service?.jiraServiceMapping;
    const projectKey = mapping?.projectKey;
    if (!projectKey) return capabilityFailure(capability, 'create');

    const issueType = mapping?.actionItemIssueType ?? 'Task';
    const labels = mapping?.defaultLabels ?? ['opsknight'];
    const component = mapping?.defaultComponent ?? null;

    try {
      const { issue, link } = await createJiraIssueAndLink({
        actionItemId,
        projectKey,
        issueType,
        summary: actionItem.title,
        description: actionItem.description || actionItem.title,
        labels,
        component,
      });

      revalidateActionItemPaths(actionItem.incidentId);
      return {
        success: true,
        key: issue.key,
        url: issue.url,
        externalIssue: toActionItemExternalIssue(link),
      };
    } catch (error) {
      // The durable create worker serializes against Link Existing. If another
      // request won that race, surface the authoritative winner rather than a
      // generic provider error.
      const winner = await currentActionItemJiraLink(actionItemId);
      if (winner) return alreadyLinkedError(winner.externalKey);

      const classified = classifyJiraError(error);
      return { success: false, error: classified.userMessage };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create Jira issue.',
    };
  }
}

export async function linkJiraIssueToActionItem(
  actionItemIdInput: string,
  jiraKeyInput: string
): Promise<JiraActionResult> {
  const parsed = LinkActionItemJiraSchema.safeParse({
    actionItemId: actionItemIdInput,
    jiraKey: jiraKeyInput,
  });
  if (!parsed.success) return validationFailure();
  const { actionItemId, jiraKey } = parsed.data;

  try {
    await assertAdminOrResponder();

    const actionItem = await prisma.actionItem.findUnique({
      where: { id: actionItemId },
      select: {
        id: true,
        incidentId: true,
        incident: { select: { serviceId: true } },
        externalIssueLinks: {
          where: { provider: 'JIRA' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { externalKey: true },
        },
      },
    });
    if (!actionItem) return { success: false, error: 'Action item not found.' };

    const existingLink = actionItem.externalIssueLinks[0];
    if (existingLink) return alreadyLinkedError(existingLink.externalKey);

    const capability = await getJiraCapabilities({
      serviceId: actionItem.incident?.serviceId ?? null,
      canManage: true,
    });
    if (!capability.canLink) return capabilityFailure(capability, 'link');

    try {
      const result = await prisma.$transaction(
        async tx => {
          // Re-check workspace state after waiting for lifecycle changes, then
          // serialize every own-ticket mutation for this action item.
          await acquireJiraWorkspaceProviderFence(tx);
          await acquireJiraActionItemLinkFence(tx, actionItemId);

          const winner = await tx.externalIssueLink.findFirst({
            where: { provider: 'JIRA', actionItemId },
            select: { externalKey: true },
          });
          if (winner) {
            throw new ActionItemJiraLinkChangedError(winner.externalKey);
          }

          return linkExistingJiraIssue({ actionItemId, jiraKey });
        },
        fencedTransactionOptions
      );

      revalidateActionItemPaths(actionItem.incidentId);
      return {
        success: true,
        key: result.issue.key,
        url: result.issue.url,
        externalIssue: toActionItemExternalIssue(result.link),
      };
    } catch (error) {
      const winner = await currentActionItemJiraLink(actionItemId);
      if (winner) return alreadyLinkedError(winner.externalKey);
      if (error instanceof ActionItemJiraLinkChangedError) return alreadyLinkedError(error.message);

      const classified = classifyJiraError(error);
      return { success: false, error: classified.userMessage };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to link Jira issue.',
    };
  }
}

export async function unlinkJiraIssueFromActionItem(
  actionItemIdInput: string,
  linkIdInput: string
): Promise<JiraActionResult> {
  const parsed = OwnedActionItemJiraSchema.safeParse({
    actionItemId: actionItemIdInput,
    linkId: linkIdInput,
  });
  if (!parsed.success) return validationFailure();
  const { actionItemId, linkId } = parsed.data;

  try {
    await assertAdminOrResponder();

    const link = await prisma.externalIssueLink.findFirst({
      where: { id: linkId, provider: 'JIRA', actionItemId },
      select: {
        id: true,
        externalKey: true,
        actionItem: {
          select: {
            incidentId: true,
            incident: { select: { serviceId: true } },
          },
        },
      },
    });
    if (!link) {
      return { success: false, error: 'Jira link not found for this action item.' };
    }

    const capability = await getJiraCapabilities({
      serviceId: link.actionItem?.incident?.serviceId ?? null,
      canManage: true,
    });
    if (!capability.canUnlink) return capabilityFailure(capability, 'unlink');

    try {
      await prisma.$transaction(
        async tx => {
          await acquireJiraWorkspaceProviderFence(tx);
          await acquireJiraActionItemLinkFence(tx, actionItemId);

          const current = await tx.externalIssueLink.findFirst({
            where: { id: linkId, provider: 'JIRA', actionItemId },
            select: { id: true },
          });
          if (!current) {
            throw new ActionItemJiraLinkChangedError('Jira link changed before unlink.');
          }

          const deleted = await tx.externalIssueLink.deleteMany({
            where: { id: linkId, provider: 'JIRA', actionItemId },
          });
          if (deleted.count !== 1) {
            throw new ActionItemJiraLinkChangedError('Jira link changed before unlink.');
          }
        },
        fencedTransactionOptions
      );
    } catch (error) {
      if (error instanceof ActionItemJiraLinkChangedError) {
        return { success: false, error: 'Jira link changed before it could be unlinked. Retry.' };
      }
      const classified = classifyJiraError(error);
      return { success: false, error: classified.userMessage };
    }

    revalidateActionItemPaths(link.actionItem?.incidentId);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unlink Jira issue.',
    };
  }
}

export async function syncActionItemJiraIssue(
  actionItemIdInput: string,
  linkIdInput: string
): Promise<JiraActionResult> {
  const parsed = OwnedActionItemJiraSchema.safeParse({
    actionItemId: actionItemIdInput,
    linkId: linkIdInput,
  });
  if (!parsed.success) return validationFailure();
  const { actionItemId, linkId } = parsed.data;

  try {
    await assertAdminOrResponder();

    const link = await prisma.externalIssueLink.findFirst({
      where: { id: linkId, provider: 'JIRA', actionItemId },
      select: {
        id: true,
        actionItem: {
          select: {
            incidentId: true,
            incident: { select: { serviceId: true } },
          },
        },
      },
    });

    if (!link) {
      return { success: false, error: 'Jira link not found for this action item.' };
    }

    const capability = await getJiraCapabilities({
      serviceId: link.actionItem?.incident?.serviceId ?? null,
      canManage: true,
    });
    if (!capability.canSync) return capabilityFailure(capability, 'sync');

    let syncedIssue: ActionItemExternalIssue;
    try {
      const result = await prisma.$transaction(
        async tx => {
          await acquireJiraWorkspaceProviderFence(tx);
          await acquireJiraActionItemLinkFence(tx, actionItemId);

          const current = await tx.externalIssueLink.findFirst({
            where: { id: linkId, provider: 'JIRA', actionItemId },
            select: { id: true },
          });
          if (!current) {
            throw new ActionItemJiraLinkChangedError('Jira link changed before sync.');
          }

          return syncExternalIssueLink(current.id);
        },
        fencedTransactionOptions
      );

      if (!result) {
        return { success: false, error: 'Jira sync failed. Check integration health in Settings.' };
      }
      syncedIssue = toActionItemExternalIssue(result);
    } catch (error) {
      if (error instanceof ActionItemJiraLinkChangedError) {
        return { success: false, error: 'Jira link changed before it could be synced. Retry.' };
      }
      const classified = classifyJiraError(error);
      return { success: false, error: classified.userMessage };
    }

    revalidateActionItemPaths(link.actionItem?.incidentId);
    return { success: true, externalIssue: syncedIssue };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync Jira issue.',
    };
  }
}
