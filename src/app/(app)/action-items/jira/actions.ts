'use server';

import prisma from '@/lib/prisma';
import { assertAdminOrResponder } from '@/lib/rbac';
import {
  createJiraIssueAndLink,
  linkExistingJiraIssue,
  syncExternalIssueLink,
} from '@/lib/jira-sync';
import { revalidatePath } from 'next/cache';

export type JiraActionResult = {
  success: boolean;
  error?: string;
  key?: string;
  url?: string;
};

function revalidateActionItemPaths(postmortemId?: string | null, incidentId?: string | null) {
  if (postmortemId) {
    revalidatePath(`/postmortems/${postmortemId}`);
  }
  if (incidentId) {
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath(`/postmortems/${incidentId}`);
  }
  revalidatePath('/action-items');
  revalidatePath('/postmortems');
}

export async function createJiraIssueFromActionItem(
  actionItemId: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const actionItem = await prisma.actionItem.findUnique({
      where: { id: actionItemId },
      select: {
        id: true,
        title: true,
        description: true,
        postmortemId: true,
        incidentId: true,
        incident: {
          select: {
            service: {
              select: {
                jiraServiceMapping: true,
              },
            },
          },
        },
      },
    });

    if (!actionItem) return { success: false, error: 'Action item not found.' };

    const mapping = actionItem.incident?.service?.jiraServiceMapping;

    const jiraConfig = await prisma.jiraConfig.findUnique({
      where: { id: 'default' },
      select: { enabled: true },
    });

    if (!jiraConfig?.enabled) {
      return { success: false, error: 'Jira is not configured or is disabled in workspace settings.' };
    }

    const projectKey = mapping?.projectKey;
    if (!projectKey) {
      return {
        success: false,
        error: 'Configure a Jira project for this service in Service Settings first.',
      };
    }

    const issueType = mapping?.actionItemIssueType ?? 'Task';
    const labels = mapping?.defaultLabels ?? ['opsknight'];
    const component = mapping?.defaultComponent ?? null;

    let issue;
    try {
      const result = await createJiraIssueAndLink({
        actionItemId,
        projectKey,
        issueType,
        summary: actionItem.title,
        description: actionItem.description || actionItem.title,
        labels,
        component,
      });
      issue = result.issue;
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      if (rawMsg.includes("target project doesn't exist")) {
        return {
          success: false,
          error: `Jira project "${projectKey}" does not exist or your API token lacks permissions. Check Services → Settings → Jira Mapping.`,
        };
      }
      if (rawMsg.includes('issue type')) {
        return {
          success: false,
          error: `Jira issue type "${issueType}" is invalid for project "${projectKey}". Change Action Item Issue Type to "Task" in Services → Settings → Jira Mapping.`,
        };
      }
      return { success: false, error: `Jira issue creation failed: ${rawMsg}` };
    }

    revalidateActionItemPaths(actionItem.postmortemId, actionItem.incidentId);
    return { success: true, key: issue.key, url: issue.url };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create Jira issue.',
    };
  }
}

export async function linkJiraIssueToActionItem(
  actionItemId: string,
  jiraKey: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const actionItem = await prisma.actionItem.findUnique({
      where: { id: actionItemId },
      select: { id: true, postmortemId: true, incidentId: true },
    });
    if (!actionItem) return { success: false, error: 'Action item not found.' };

    let issue;
    try {
      const result = await linkExistingJiraIssue({
        actionItemId,
        jiraKey,
      });
      issue = result.issue;
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      if (rawMsg.includes('already linked')) {
        return {
          success: false,
          error: `Jira issue "${jiraKey.trim()}" is already linked to another incident or item.`,
        };
      }
      if (rawMsg.includes('not found') || rawMsg.includes('404')) {
        return {
          success: false,
          error: `Jira issue "${jiraKey.trim()}" was not found in your Jira workspace.`,
        };
      }
      return { success: false, error: `Failed to link Jira issue: ${rawMsg}` };
    }

    revalidateActionItemPaths(actionItem.postmortemId, actionItem.incidentId);
    return { success: true, key: issue.key, url: issue.url };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to link Jira issue.',
    };
  }
}

export async function unlinkJiraIssueFromActionItem(
  linkId: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const link = await prisma.externalIssueLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        actionItem: { select: { postmortemId: true, incidentId: true } },
      },
    });
    if (!link) return { success: false, error: 'Link not found.' };

    await prisma.externalIssueLink.delete({
      where: { id: linkId },
    });

    revalidateActionItemPaths(link.actionItem?.postmortemId, link.actionItem?.incidentId);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unlink Jira issue.',
    };
  }
}

export async function syncActionItemJiraIssue(
  linkId: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const link = await prisma.externalIssueLink.findUnique({
      where: { id: linkId },
      select: {
        actionItem: { select: { postmortemId: true, incidentId: true } },
      },
    });

    await syncExternalIssueLink(linkId);

    revalidateActionItemPaths(link?.actionItem?.postmortemId, link?.actionItem?.incidentId);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync Jira issue.',
    };
  }
}
