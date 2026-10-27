import 'server-only';
import type { Prisma } from '@prisma/client';
import { RESPONSE_LIMITS } from '../contract';
import type { FindingRow } from '../similarity/findings';
import { rankRunbooks, type RunbookOutcomeCounts } from './wilson';

const DAY_MS = 86_400_000;
const MAX_BOUND_RUNBOOKS = 50;

/**
 * Ranks runbooks for an incident's service by how reliably they have worked here. Candidates are the
 * runbooks bound to the service plus any that have been executed against it. Only published,
 * non-archived runbooks are recommended. Recommendation only: nothing is ever executed from here.
 */
export async function computeRunbookFindings(
  tx: Prisma.TransactionClient,
  incident: { serviceId: string },
  now: Date = new Date()
): Promise<FindingRow[]> {
  const since = new Date(now.getTime() - RESPONSE_LIMITS.runbookHistoryDays * DAY_MS);
  const [bindings, history] = await Promise.all([
    tx.serviceAutomationRule.findMany({
      where: { serviceId: incident.serviceId, enabled: true, detachedAt: null },
      take: MAX_BOUND_RUNBOOKS,
      select: { runbookId: true },
    }),
    tx.runbookExecution.groupBy({
      by: ['runbookId', 'status'],
      where: {
        serviceId: incident.serviceId,
        createdAt: { gte: since },
        status: { in: ['SUCCEEDED', 'FAILED', 'TIMED_OUT'] },
      },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, RunbookOutcomeCounts>();
  const entry = (runbookId: string) => {
    let existing = counts.get(runbookId);
    if (!existing) {
      existing = { runbookId, succeeded: 0, eligible: 0, bound: false };
      counts.set(runbookId, existing);
    }
    return existing;
  };
  for (const binding of bindings) entry(binding.runbookId).bound = true;
  for (const row of history) {
    const target = entry(row.runbookId);
    target.eligible += row._count._all;
    if (row.status === 'SUCCEEDED') target.succeeded += row._count._all;
  }
  if (counts.size === 0) return [];

  const usable = await tx.runbook.findMany({
    where: { id: { in: [...counts.keys()] }, archivedAt: null, publishedVersionId: { not: null } },
    select: { id: true },
  });
  const usableIds = new Set(usable.map(runbook => runbook.id));
  const ranked = rankRunbooks(
    [...counts.values()].filter(candidate => usableIds.has(candidate.runbookId) && (candidate.bound || candidate.succeeded > 0)),
    RESPONSE_LIMITS.maxRunbookFindings
  );
  return ranked.map(candidate => ({
    confidence: candidate.confidence,
    subjectRef: candidate.runbookId,
    evidence: {
      type: 'runbook_history',
      calibrated: false,
      succeeded: candidate.succeeded,
      eligible: candidate.eligible,
      bound: candidate.bound,
      windowDays: RESPONSE_LIMITS.runbookHistoryDays,
    },
  }));
}
