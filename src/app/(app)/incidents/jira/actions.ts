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

export async function createJiraIssueFromIncident(
  incidentId: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: {
          include: {
            jiraServiceMapping: true,
          },
        },
      },
    });

    if (!incident) return { success: false, error: 'Incident not found.' };

    const mapping = incident.service?.jiraServiceMapping;

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
        error: 'Configure a Jira project for this service in Service Settings before creating Jira issues.',
      };
    }

    const issueType = mapping?.incidentIssueType ?? 'Bug';
    const labels = mapping?.defaultLabels ?? ['opsknight'];
    const component = mapping?.defaultComponent ?? null;

    const summary = `[Incident] ${incident.title}`;
    const description = incident.description || `OpsKnight Incident: ${incident.title}`;

    let issue;
    try {
      const result = await createJiraIssueAndLink({
        incidentId,
        projectKey,
        issueType,
        summary,
        description,
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
          error: `Jira issue type "${issueType}" is invalid for project "${projectKey}". Change Incident Issue Type to "Task" in Services → Settings → Jira Mapping.`,
        };
      }
      if (rawMsg.includes('Component') || rawMsg.includes('component')) {
        return {
          success: false,
          error: `Component "${component}" does not exist in Jira project "${projectKey}". Clear Default Component in Services → Settings → Jira Mapping.`,
        };
      }
      return { success: false, error: `Jira issue creation failed: ${rawMsg}` };
    }

    // Create timeline event
    await prisma.incidentEvent.create({
      data: {
        incidentId,
        type: 'COMMENT',
        message: `Jira issue ${issue.key} created`,
      },
    });

    revalidatePath(`/incidents/${incidentId}`);
    return { success: true, key: issue.key, url: issue.url };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create Jira issue.',
    };
  }
}

export async function linkJiraIssueToIncident(
  incidentId: string,
  jiraKey: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { id: true },
    });
    if (!incident) return { success: false, error: 'Incident not found.' };

    let issue;
    try {
      const result = await linkExistingJiraIssue({
        incidentId,
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

    await prisma.incidentEvent.create({
      data: {
        incidentId,
        type: 'COMMENT',
        message: `Jira issue ${issue.key} linked`,
      },
    });

    revalidatePath(`/incidents/${incidentId}`);
    return { success: true, key: issue.key, url: issue.url };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to link Jira issue.',
    };
  }
}

export async function unlinkJiraIssueFromIncident(
  linkId: string,
  incidentId: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();

    const link = await prisma.externalIssueLink.findUnique({
      where: { id: linkId },
      select: { id: true, externalKey: true, incidentId: true },
    });
    if (!link || link.incidentId !== incidentId) return { success: false, error: 'Link not found.' };

    await prisma.externalIssueLink.delete({
      where: { id: linkId },
    });

    await prisma.incidentEvent.create({
      data: {
        incidentId,
        type: 'COMMENT',
        message: `Jira issue ${link.externalKey} unlinked`,
      },
    });

    revalidatePath(`/incidents/${incidentId}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unlink Jira issue.',
    };
  }
}

export async function syncIncidentJiraIssue(
  linkId: string,
  incidentId: string
): Promise<JiraActionResult> {
  try {
    await assertAdminOrResponder();
    await syncExternalIssueLink(linkId);
    revalidatePath(`/incidents/${incidentId}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync Jira issue.',
    };
  }
}
