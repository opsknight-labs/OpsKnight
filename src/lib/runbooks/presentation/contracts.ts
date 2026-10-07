import type { Prisma, RunbookAgentStatus } from '@prisma/client';
import { RUNBOOK_EXECUTION_STATUSES, isActiveExecutionStatus } from '../types';
import { startOfDayFromDateKey, startOfNextDayFromDateKey } from '@/lib/timezone';
import { z } from 'zod';

export { RUNBOOK_EXECUTION_STATUSES };
export const ACTIVE_EXECUTION_STATUSES = RUNBOOK_EXECUTION_STATUSES.filter(isActiveExecutionStatus);
export const TRIGGER_LABELS = {
  USER: 'Responder', TRIGGER: 'Automation trigger', API: 'API', CHATOPS: 'ChatOps', SCHEDULE: 'Schedule',
} as const;
export type NavigationSummary = { activeExecutions?: number; onlineAgents?: number; health: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN' };
export const HEARTBEAT_FRESHNESS_MS = 90_000;
export function resolveEffectiveAgentStatus(agent: { status: RunbookAgentStatus; lastHeartbeatAt: Date | null }, now: Date): RunbookAgentStatus {
  return ['ONLINE', 'DEGRADED'].includes(agent.status) && (!agent.lastHeartbeatAt || agent.lastHeartbeatAt.getTime() < now.getTime() - HEARTBEAT_FRESHNESS_MS)
    ? 'OFFLINE' : agent.status;
}
export function getExecutionProgress(steps: readonly { status: string; stepKey: string }[]) {
  return { totalSteps: steps.length, completedSteps: steps.filter(step => ['SUCCEEDED', 'SKIPPED'].includes(step.status)).length,
    failedStepName: steps.find(step => ['FAILED', 'UNKNOWN'].includes(step.status))?.stepKey ?? null };
}
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export function getExecutionDateRange(query: Record<string, string>, timeZone: string, now: Date) {
  const hours = { '1h': 1, '24h': 24, '7d': 168 }[query.timeRange];
  const from = dateKey.safeParse(query.from); const to = dateKey.safeParse(query.to);
  return { gte: hours ? new Date(now.getTime() - hours * 3600000) : from.success ? startOfDayFromDateKey(from.data, timeZone) : undefined,
    lt: !hours && to.success ? startOfNextDayFromDateKey(to.data, timeZone) : undefined };
}
export function getUnknownOutcomeWhere(): Prisma.RunbookExecutionWhereInput {
  return { steps: { some: { OR: [{ status: 'UNKNOWN' }, { attempts: { some: { status: 'UNKNOWN' } } }] } } };
}
export function getSuccessRate(states: readonly { status: string; _count: { id: number } }[]) {
  const eligible = states.filter(row => ['SUCCEEDED', 'FAILED', 'TIMED_OUT'].includes(row.status));
  const total = eligible.reduce((sum, row) => sum + row._count.id, 0);
  return { total, percent: total ? Math.round((eligible.find(row => row.status === 'SUCCEEDED')?._count.id ?? 0) / total * 100) : null };
}
