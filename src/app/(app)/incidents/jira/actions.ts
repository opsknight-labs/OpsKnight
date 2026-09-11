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
import { withJiraWorkspaceProviderFence } from '@/lib/jira-concurrency';
import { revalidatePath } from 'next/cache';

export type JiraActionResult = {
  success: boolean;
  error?: string;
  key?: string;
  url?: string;
};

const EntityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid identifier.');

const IncidentJiraSchema = z.object({ incidentId: EntityIdSchema }).strict();
const LinkIncidentJiraSchema = z
  .object({
    incidentId: EntityIdSchema,
    jiraKey: z.string().trim().min(1).max(255),
  })
  .strict();
const OwnedIncidentJiraSchema = z
  .object({
    incidentId: EntityIdSchema,
    linkId: EntityIdSchema,
  })
  .strict();

function validationFailure(): JiraActionResult {
  return { success: false, error: 'Invalid Jira action request.' };
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
      error:
        'Configure a Jira project for this service in Service Settings before creating Jira issues.',
    };
  }
  if (operation === 'sync' && !capability.syncEnabled) {
    return { success: false, error: 'Jira metadata sync is disabled for this service.' };
  }
  return { success: false, error: `Jira ${operation} is not allowed for this incident.` };
}

export async function createJiraIssueFromIncident(
  incidentIdInput: string
): Promise<JiraActionResult> {
  const parsed = IncidentJiraSchema.safeParse({ incidentId: incidentIdInput });
  if (!parsed.success) return validationFailure();
  const { incidentId } = parsed.data;

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

    const capability = await getJiraCapabilities({
      serviceId: incident.serviceId,
      canManage: true,
    });
    if (!capability.canCreate) return capabilityFailure(capability, 'create');

    const mapping = incident.service?.jiraServiceMapping;
    const projectKey = mapping?.projectKey;
    if (!projectKey) return capabilityFailure(capability, 'create');

    const issueType = mapping?.incidentIssueType ?? 'Bug';
    const labels = mapping?.defaultLabels ?? ['opsknight'];
    const component = mapping?.defaultComponent ?? null;
    const summary = `[Incident] ${incident.title}`;
    const description = incident.description || `OpsKnight Incident: ${incident.title}`;

    try {
      const { issue } = await createJiraIssueAndLink({
        incidentId,
        projectKey,
        issueType,
        summary,
        description,
        labels,
        component,
      });

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

export async function linkJiraIssueToIncident(
  incidentIdInput: string,
  jiraKeyInput: string
): Promise<JiraActionResult> {
  const parsed = LinkIncidentJiraSchema.safeParse({
    incidentId: incidentIdInput,
    jiraKey: jiraKeyInput,
  });
  if (!parsed.success) return validationFailure();
  const { incidentId, jiraKey } = parsed.data;

  try {
    await assertAdminOrResponder();

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { id: true, serviceId: true },
    });
    if (!incident) return { success: false, error: 'Incident not found.' };

    const capability = await getJiraCapabilities({
      serviceId: incident.serviceId,
      canManage: true,
    });
    if (!capability.canLink) return capabilityFailure(capability, 'link');

    try {
      const { issue } = await withJiraWorkspaceProviderFence(async () => {
        const linked = await linkExistingJiraIssue({ incidentId, jiraKey });
        await prisma.incidentEvent.create({
          data: {
            incidentId,
            type: 'COMMENT',
            message: `Jira issue ${linked.issue.key} linked`,
          },
        });
        return linked;
      });

      revalidatePath(`/incidents/${incidentId}`);
      return { success: true, key: issue.key, url: issue.url };
    } catch (error) {
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

export async function unlinkJiraIssueFromIncident(
  linkIdInput: string,
  incidentIdInput: string
): Promise<JiraActionResult> {
  const parsed = OwnedIncidentJiraSchema.safeParse({
    incidentId: incidentIdInput,
    linkId: linkIdInput,
  });
  if (!parsed.success) return validationFailure();
  const { incidentId, linkId } = parsed.data;

  try {
    await assertAdminOrResponder();

    const ownershipWhere = {
      id: linkId,
      provider: 'JIRA' as const,
      incidentId,
    };

    const link = await prisma.externalIssueLink.findFirst({
      where: ownershipWhere,
      select: {
        id: true,
        externalKey: true,
        incidentId: true,
        incident: { select: { serviceId: true } },
      },
    });
    if (!link) return { success: false, error: 'Jira link not found for this incident.' };

    const capability = await getJiraCapabilities({
      serviceId: link.incident?.serviceId ?? null,
      canManage: true,
    });
    if (!capability.canUnlink) return capabilityFailure(capability, 'unlink');

    try {
      const deleted = await withJiraWorkspaceProviderFence(() =>
        prisma.externalIssueLink.deleteMany({ where: ownershipWhere })
      );
      if (deleted.count !== 1) {
        return { success: false, error: 'Jira link changed before it could be unlinked. Retry.' };
      }
    } catch (error) {
      const classified = classifyJiraError(error);
      return { success: false, error: classified.userMessage };
    }

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
  linkIdInput: string,
  incidentIdInput: string
): Promise<JiraActionResult> {
  const parsed = OwnedIncidentJiraSchema.safeParse({
    incidentId: incidentIdInput,
    linkId: linkIdInput,
  });
  if (!parsed.success) return validationFailure();
  const { incidentId, linkId } = parsed.data;

  try {
    await assertAdminOrResponder();

    const link = await prisma.externalIssueLink.findFirst({
      where: {
        id: linkId,
        provider: 'JIRA',
        incidentId,
      },
      select: {
        id: true,
        incident: { select: { serviceId: true } },
      },
    });
    if (!link) return { success: false, error: 'Jira link not found for this incident.' };

    const capability = await getJiraCapabilities({
      serviceId: link.incident?.serviceId ?? null,
      canManage: true,
    });
    if (!capability.canSync) return capabilityFailure(capability, 'sync');

    try {
      const result = await withJiraWorkspaceProviderFence(() => syncExternalIssueLink(link.id));
      if (!result) {
        return { success: false, error: 'Jira sync failed. Check integration health in Settings.' };
      }
    } catch (error) {
      const classified = classifyJiraError(error);
      return { success: false, error: classified.userMessage };
    }

    revalidatePath(`/incidents/${incidentId}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync Jira issue.',
    };
  }
}
