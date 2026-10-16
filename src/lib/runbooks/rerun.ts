import prisma from '@/lib/prisma';
import type { RunbookExecutionRequest } from '@/lib/runbooks/orchestrator';
import { TERMINAL_EXECUTION_STATUSES, type RunbookExecutionStatus } from '@/lib/runbooks/types';

export type RerunSource = {
  id: string;
  status: string;
  runbookId: string;
  incidentId: string | null;
  serviceId: string | null;
  inputValues: unknown;
  runbook: { archivedAt: Date | null; publishedVersionId: string | null };
  binding: {
    id: string;
    serviceId: string;
    enabled: boolean;
    detachedAt: Date | null;
    versionStrategy: string;
    runbookVersionId: string | null;
  } | null;
};

export const rerunSourceSelect = {
  id: true,
  status: true,
  runbookId: true,
  incidentId: true,
  serviceId: true,
  inputValues: true,
  runbook: { select: { archivedAt: true, publishedVersionId: true } },
  binding: {
    select: {
      id: true,
      serviceId: true,
      enabled: true,
      detachedAt: true,
      versionStrategy: true,
      runbookVersionId: true,
    },
  },
} as const;

export function isRerunnableStatus(status: string): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status as RunbookExecutionStatus);
}

/** Returns why a re-run is unavailable, or null when the preview path may be attempted. */
export function getRerunBlockedReason(
  source: Omit<RerunSource, 'id' | 'inputValues' | 'runbookId'>
): string | null {
  if (!isRerunnableStatus(source.status))
    return 'Only finished executions can be re-run. Cancel or wait for this run to finish.';
  if (source.runbook.archivedAt) return 'This runbook is archived. Restore it before re-running.';
  if (source.binding?.detachedAt)
    return 'The service rule that started this run was detached. Attach the runbook to the service again to re-run it.';
  if (source.binding && !source.binding.enabled)
    return 'The service rule that started this run is paused. Enable the rule to re-run it.';
  if (source.incidentId && !source.binding)
    return 'The service rule that started this incident run no longer exists. Attach the runbook to the service again to re-run it.';
  const pinned = source.binding?.versionStrategy === 'PINNED';
  if (pinned ? !source.binding?.runbookVersionId : !source.runbook.publishedVersionId)
    return 'This runbook has no published version to run.';
  return null;
}

/** Builds a manual request equivalent to the original run; the orchestrator re-validates it. */
export function buildRerunRequest(source: RerunSource, actorId: string): RunbookExecutionRequest {
  const binding = source.binding;
  const inputValues =
    source.inputValues &&
    typeof source.inputValues === 'object' &&
    !Array.isArray(source.inputValues)
      ? (source.inputValues as Record<string, unknown>)
      : {};
  return {
    runbookId: source.runbookId,
    runbookVersionId:
      (binding?.versionStrategy === 'PINNED'
        ? binding.runbookVersionId
        : source.runbook.publishedVersionId) ?? undefined,
    serviceId: source.serviceId ?? binding?.serviceId ?? undefined,
    incidentId: source.incidentId ?? undefined,
    bindingId: binding?.id,
    // Service rules always execute with their saved inputs.
    inputValues: binding ? undefined : inputValues,
    triggeredByUserId: actorId,
  };
}

export async function loadRerunSource(executionId: string): Promise<RerunSource | null> {
  return prisma.runbookExecution.findUnique({
    where: { id: executionId },
    select: rerunSourceSelect,
  });
}
