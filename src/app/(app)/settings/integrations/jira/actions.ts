'use server';

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { assertAdmin } from '@/lib/rbac';
import { normalizeJiraBaseUrl } from '@/lib/jira-validation';
import { acquireJiraWorkspaceLifecycleFence } from '@/lib/jira-concurrency';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import {
  SettingsChangedMutationError,
  isSettingsChangedError,
  parseSettingsRevision,
  settingsChangedState,
  type SettingsActionState,
} from '@/lib/settings-result';

const JiraConfigSchema = z
  .object({
    baseUrl: z.string().trim().min(1, 'Jira site URL is required.'),
    userEmail: z.string().trim().email('A valid Jira user email is required.'),
    apiToken: z.string(),
    webhookSecret: z.string(),
    enabled: z.boolean(),
  })
  .strict();

const JiraWorkspaceRemovalSchema = z
  .object({
    confirmation: z.literal('REMOVE JIRA'),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

type LockedJiraWorkspace = {
  id: string;
  baseUrl: string;
  userEmail: string;
  enabled: boolean;
  webhookSecretEncrypted: string | null;
  updatedAt: Date;
};

function revalidateJiraWorkspacePaths() {
  revalidatePath('/settings');
  revalidatePath('/settings/integrations/jira');
  revalidatePath('/services');
  revalidatePath('/incidents');
  revalidatePath('/action-items');
  revalidatePath('/postmortems');
}

export async function saveJiraConfig(
  prevState: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  const expectedUpdatedAt = prevState?.updatedAt ?? null;
  let actor;
  try {
    actor = await assertAdmin();
  } catch (error) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
      updatedAt: expectedUpdatedAt,
    };
  }

  try {
    const parsed = JiraConfigSchema.safeParse({
      baseUrl: (formData.get('baseUrl') as string | null) ?? '',
      userEmail: (formData.get('userEmail') as string | null) ?? '',
      apiToken: ((formData.get('apiToken') as string | null) ?? '').trim(),
      webhookSecret: ((formData.get('webhookSecret') as string | null) ?? '').trim(),
      enabled: ['on', 'true'].includes(String(formData.get('enabled') ?? '')),
    });

    if (!parsed.success) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: parsed.error.issues[0]?.message || 'Invalid Jira configuration.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const baseUrl = normalizeJiraBaseUrl(parsed.data.baseUrl);
    const userEmail = parsed.data.userEmail.trim().toLowerCase();
    const { apiToken, webhookSecret, enabled } = parsed.data;

    const existing = await prisma.jiraConfig.findUnique({ where: { id: 'default' } });
    const expectedRevision = parseSettingsRevision(expectedUpdatedAt);
    if (existing && !expectedRevision) return settingsChangedState(expectedUpdatedAt);
    if (!existing && expectedRevision) return settingsChangedState(expectedUpdatedAt);

    if (!existing && !apiToken) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Jira API token is required for new configuration.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const apiTokenEncrypted =
      apiToken && apiToken !== '********' ? await encrypt(apiToken) : existing?.apiTokenEncrypted;
    const webhookSecretEncrypted =
      webhookSecret && webhookSecret !== '********'
        ? await encrypt(webhookSecret)
        : existing?.webhookSecretEncrypted;

    if (!apiTokenEncrypted) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Jira API token is required.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const updatedAt = await prisma.$transaction(async tx => {
      // Configuration changes are workspace lifecycle changes. Fence them
      // against in-flight Jira provider work so disable/credential changes
      // cannot be overtaken by a request that was admitted under stale state.
      await acquireJiraWorkspaceLifecycleFence(tx);

      if (existing) {
        const updated = await tx.jiraConfig.updateMany({
          where: { id: existing.id, updatedAt: expectedRevision! },
          data: {
            baseUrl,
            userEmail,
            apiTokenEncrypted,
            enabled,
            defaultProjectKey: null,
            webhookSecretEncrypted,
            updatedBy: actor.id,
          },
        });
        if (updated.count !== 1) throw new SettingsChangedMutationError();
      } else {
        await tx.jiraConfig.create({
          data: {
            id: 'default',
            baseUrl,
            userEmail,
            apiTokenEncrypted,
            enabled,
            defaultProjectKey: null,
            webhookSecretEncrypted,
            updatedBy: actor.id,
          },
        });
      }

      await logAudit(
        {
          action: 'jira.config.updated',
          entityType: 'USER',
          entityId: actor.id,
          actorId: actor.id,
          oldValue: existing
            ? {
                enabled: existing.enabled,
                baseUrl: existing.baseUrl,
                userEmail: existing.userEmail,
                hasWebhookSecret: Boolean(existing.webhookSecretEncrypted),
              }
            : null,
          newValue: {
            enabled,
            baseUrl,
            userEmail,
            hasWebhookSecret: Boolean(webhookSecretEncrypted),
          },
          details: { integration: 'jira' },
        },
        tx
      );

      const saved = await tx.jiraConfig.findUniqueOrThrow({
        where: { id: existing?.id ?? 'default' },
        select: { updatedAt: true },
      });
      return saved.updatedAt.toISOString();
    });

    revalidateJiraWorkspacePaths();

    return { success: true, error: null, updatedAt };
  } catch (error) {
    if (
      isSettingsChangedError(error) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      return settingsChangedState(expectedUpdatedAt);
    }
    logger.error('settings.jira.save_failed', { error });
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to save Jira configuration.',
      updatedAt: expectedUpdatedAt,
    };
  }
}

/**
 * Permanently removes active Jira workspace state from OpsKnight.
 *
 * Historical incident events and audit logs are intentionally retained as
 * immutable operational evidence. Provider tickets in Jira are never deleted.
 */
export async function removeJiraWorkspace(formData: FormData): Promise<SettingsActionState> {
  // Destructive actions must establish a strict input boundary before any
  // authorization lookup or mutation. This also rejects unexpected form keys,
  // Files, malformed revisions, and near-miss confirmation phrases.
  const parsed = JiraWorkspaceRemovalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const hasBadConfirmation = parsed.error.issues.some(issue => issue.path[0] === 'confirmation');
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: hasBadConfirmation
        ? 'Type REMOVE JIRA exactly to confirm permanent workspace removal.'
        : 'The Jira settings revision is invalid. Reload the page and try again.',
      updatedAt: null,
    };
  }

  const expectedUpdatedAt = parsed.data.updatedAt;
  const expectedRevision = parseSettingsRevision(expectedUpdatedAt);
  if (!expectedRevision) return settingsChangedState(expectedUpdatedAt);

  let actor;
  try {
    actor = await assertAdmin();
  } catch (error) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
      updatedAt: expectedUpdatedAt,
    };
  }

  try {
    await prisma.$transaction(async tx => {
      // Take the exclusive cluster-wide Jira lifecycle fence first. In-flight
      // provider work holds the shared form of this lock, so removal cannot
      // overtake an already-admitted remote mutation. New work waits, then
      // observes that the workspace no longer exists and fails closed.
      await acquireJiraWorkspaceLifecycleFence(tx);

      // The row lock additionally coordinates with the database trigger that
      // guards stale JiraServiceMapping writes.
      const [current] = await tx.$queryRaw<LockedJiraWorkspace[]>`
        SELECT
          "id",
          "baseUrl",
          "userEmail",
          "enabled",
          "webhookSecretEncrypted",
          "updatedAt"
        FROM "JiraConfig"
        WHERE "id" = 'default'
        FOR UPDATE
      `;

      if (!current || current.updatedAt.getTime() !== expectedRevision.getTime()) {
        throw new SettingsChangedMutationError();
      }

      // BackgroundJob has a generic JSON payload instead of a provider FK.
      // Delete only jobs whose operationId belongs to a Jira ExternalOperation.
      const backgroundJobsRemoved = await tx.$executeRaw`
        DELETE FROM "BackgroundJob"
        WHERE "type" = 'EXTERNAL_OPERATION'
          AND ("payload"->>'operationId') IN (
            SELECT "id" FROM "ExternalOperation" WHERE "provider" = 'JIRA'
          )
      `;

      const providerAdmission = await tx.providerAdmission.deleteMany({
        where: { key: { startsWith: 'jira:' } },
      });
      const externalLinks = await tx.externalIssueLink.deleteMany({
        where: { provider: 'JIRA' },
      });
      const serviceMappings = await tx.jiraServiceMapping.deleteMany({});
      const externalOperations = await tx.externalOperation.deleteMany({
        where: { provider: 'JIRA' },
      });

      // Legacy postmortem JSON may contain a cached externalIssue projection.
      // Normalized ActionItem rows remain authoritative, but remove that stale
      // Jira snapshot as part of a full workspace disconnect.
      const legacySnapshotsScrubbed = await tx.$executeRaw`
        UPDATE "Postmortem"
        SET "actionItems" = (
          SELECT COALESCE(jsonb_agg(
            CASE
              WHEN jsonb_typeof(item) = 'object' THEN item - 'externalIssue'
              ELSE item
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements("Postmortem"."actionItems"::jsonb) AS item
        )
        WHERE "actionItems" IS NOT NULL
          AND jsonb_typeof("actionItems"::jsonb) = 'array'
          AND "actionItems"::jsonb @> '[{"externalIssue": {}}]'::jsonb
      `;

      const removedConfig = await tx.jiraConfig.deleteMany({
        where: { id: current.id, updatedAt: expectedRevision },
      });
      if (removedConfig.count !== 1) throw new SettingsChangedMutationError();

      await logAudit(
        {
          action: 'jira.workspace.removed',
          entityType: 'USER',
          entityId: actor.id,
          actorId: actor.id,
          oldValue: {
            enabled: current.enabled,
            baseUrl: current.baseUrl,
            userEmail: current.userEmail,
            hasWebhookSecret: Boolean(current.webhookSecretEncrypted),
          },
          newValue: null,
          details: {
            integration: 'jira',
            serviceMappingsRemoved: serviceMappings.count,
            externalLinksRemoved: externalLinks.count,
            externalOperationsRemoved: externalOperations.count,
            providerAdmissionRowsRemoved: providerAdmission.count,
            backgroundJobsRemoved,
            legacySnapshotsScrubbed,
            providerIssuesDeleted: false,
            historyRetained: true,
          },
        },
        tx
      );
    });

    revalidateJiraWorkspacePaths();
    return { success: true, error: null, updatedAt: null };
  } catch (error) {
    if (isSettingsChangedError(error)) return settingsChangedState(expectedUpdatedAt);
    logger.error('settings.jira.remove_failed', { error });
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to remove the Jira workspace. No provider tickets were deleted.',
      updatedAt: expectedUpdatedAt,
    };
  }
}
