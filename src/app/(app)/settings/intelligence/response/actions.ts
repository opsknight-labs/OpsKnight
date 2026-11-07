'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import {
  declareDependency,
  removeDependency,
  reviewDependency,
} from '@/lib/intelligence/dependencies/service';
import { applyCatalogImport, parseCatalog } from '@/lib/intelligence/dependencies/import';
import {
  createTopologySource,
  removeTopologySource,
  requestTopologySync,
} from '@/lib/intelligence/dependencies/topology-sources';
import { createJiraIssue, getDecryptedJiraConfig } from '@/lib/jira';
import { getAlertQualityLeaderboard } from '@/lib/intelligence/triage/alert-quality';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

/**
 * Opens a Jira issue asking the owning team to fix a noisy alert source. Uses the service's Jira mapping
 * (project, action-item issue type, labels, component) or the workspace default project. The issue text
 * is built from the leaderboard the person can see, never from the form.
 */
export async function createNoisyAlertIssueAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const serviceId = text(form, 'serviceId');
    const actor = await getCurrentAuthorizationActor();
    const row = (await getAlertQualityLeaderboard(actor)).find(
      entry => entry.serviceId === serviceId
    );
    if (!row) return { message: 'That service is no longer on the alert-quality list.', ok: false };
    const config = await getDecryptedJiraConfig();
    if (!config) return { message: 'Jira is not configured.', ok: false };
    const mapping = await prisma.jiraServiceMapping.findUnique({ where: { serviceId } });
    const projectKey =
      mapping?.projectKey ??
      (
        await prisma.jiraConfig.findUnique({
          where: { id: 'default' },
          select: { defaultProjectKey: true },
        })
      )?.defaultProjectKey;
    if (!projectKey)
      return {
        message: 'No Jira project is mapped for this service and no default project is set.',
        ok: false,
      };
    const issue = await createJiraIssue({
      projectKey,
      issueType: mapping?.actionItemIssueType ?? 'Task',
      summary: `Reduce alert noise for ${row.serviceName}`.slice(0, 255),
      description: [
        `OpsKnight Intelligence flagged ${row.serviceName} as a noisy alert source over the last 30 days.`,
        `Incidents: ${row.incidents}. Resolved within 5 minutes: ${Math.round(row.quickResolvedRatio * 100)}%. Never acknowledged: ${Math.round(row.neverAcknowledgedRatio * 100)}%. Opened as flapping: ${Math.round(row.flappingRatio * 100)}%.`,
        'Consider raising thresholds, adding a maintenance window, lowering the severity mapping, or fixing the self-clearing condition.',
      ].join('\n\n'),
      labels: [...(mapping?.defaultLabels ?? []), 'alert-noise'],
      component: mapping?.defaultComponent ?? null,
    });
    await logAudit({
      action: 'intelligence.alert_quality.issue_created',
      entityType: 'SYSTEM_CONFIG',
      entityId: `intelligence-alert-quality:${serviceId}`,
      actorId: user.id,
      source: 'UI',
      details: { serviceId, issueKey: issue.key },
    });
    revalidatePath(PATH);
    return { message: `Created ${issue.key}.`, ok: true };
  } catch (error) {
    return failure(error);
  }
}

export type DependencyActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/response';

function failure(error: unknown): DependencyActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return {
      message: detail ? `${error.userMessage} (${detail.message})` : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Intelligence] Dependency action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export async function declareDependencyAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await declareDependency(
      {
        upstreamServiceId: text(form, 'upstreamServiceId'),
        downstreamServiceId: text(form, 'downstreamServiceId'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: 'Dependency saved.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function reviewDependencyAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const decision = text(form, 'decision');
    if (decision !== 'APPROVE' && decision !== 'REJECT')
      return { message: 'Choose approve or reject.', ok: false };
    const result = await reviewDependency(text(form, 'id'), decision, {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(PATH);
    return result === 'updated'
      ? {
          message: decision === 'APPROVE' ? 'Dependency approved.' : 'Suggestion rejected.',
          ok: true,
        }
      : { message: 'That suggestion no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function removeDependencyAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await removeDependency(text(form, 'id'), { actorId: actor.id, source: 'UI' });
    revalidatePath(PATH);
    return result === 'removed'
      ? { message: 'Dependency removed.', ok: true }
      : { message: 'That dependency no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

/** Imports a pasted Backstage catalog (YAML or JSON) as declared dependencies. */
export async function importCatalogAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const entities = parseCatalog(text(form, 'catalog'));
    const summary = await prisma.$transaction(tx =>
      applyCatalogImport(tx, entities, { actorId: actor.id, source: 'UI' }, 'upload')
    );
    revalidatePath(PATH);
    const unmatched = summary.unmatched.length
      ? ` ${summary.unmatched.length} entities matched no service (${summary.unmatched.slice(0, 5).join(', ')}${summary.unmatched.length > 5 ? '…' : ''}).`
      : '';
    return {
      message: `${summary.entities} entities read, ${summary.matched} matched; ${summary.edgesDeclared} dependencies declared, ${summary.edgesUnchanged} already present.${unmatched}`,
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function addTopologySourceAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const interval = Number(text(form, 'intervalMinutes') || '60');
    await createTopologySource(
      {
        name: text(form, 'name'),
        url: text(form, 'url'),
        intervalMinutes: Number.isFinite(interval) ? Math.round(interval) : 60,
        enabled: true,
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return {
      message: 'Catalog source added. It is pulled on its schedule or with Sync now.',
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function removeTopologySourceAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await removeTopologySource(text(form, 'id'), {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(PATH);
    return result === 'removed'
      ? { message: 'Catalog source removed. Dependencies it declared are kept.', ok: true }
      : { message: 'That source no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function syncTopologySourceAction(
  _state: DependencyActionState,
  form: FormData
): Promise<DependencyActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const queued = await requestTopologySync(text(form, 'id'));
    revalidatePath(PATH);
    return queued
      ? { message: 'Sync queued; the result appears here once the lane has pulled it.', ok: true }
      : { message: 'That source no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}
