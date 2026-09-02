import { Incident, Service } from '@prisma/client';
import { resolveSlaTarget } from './metrics/domain/sla-target';
import { effectiveMaterializedElapsedMs } from './metrics/domain/sla-clock';

// Priority-based SLA targets (in minutes)
export type SlaTargetService = {
  targetAckMinutes?: number | null;
  targetResolveMinutes?: number | null;
};

export function getPrioritySLATarget(
  priority: string | null | undefined,
  service: SlaTargetService
): { ack: number; resolve: number } {
  const target = resolveSlaTarget({
    priority,
    serviceTargets: {
      ackMinutes: service.targetAckMinutes,
      resolveMinutes: service.targetResolveMinutes,
    },
  });
  return {
    ack: target.ackTargetMs / 60_000,
    resolve: target.resolveTargetMs / 60_000,
  };
}

export function checkPriorityAckSLA(
  incident: Incident & { snoozedMs?: number },
  service: SlaTargetService,
  snoozedMs?: number
): boolean {
  if (!incident.acknowledgedAt || !incident.createdAt || !incident.priority) return false;
  const snooze = snoozedMs ?? incident.snoozedMs ?? 0;
  const activeMs = effectiveMaterializedElapsedMs({
    startedAt: incident.createdAt,
    evaluationAt: incident.acknowledgedAt,
    pausedMs: incident.slaPausedMs ?? snooze,
    pauseStartedAt: incident.slaPauseStartedAt,
  });
  const ackTimeMinutes = activeMs / 1000 / 60;
  const target = getPrioritySLATarget(incident.priority, service);
  return ackTimeMinutes <= target.ack;
}

export function checkPriorityResolveSLA(
  incident: Incident & { snoozedMs?: number },
  service: SlaTargetService,
  snoozedMs?: number
): boolean {
  if (!incident.resolvedAt || !incident.createdAt || !incident.priority) return false;
  const snooze = snoozedMs ?? incident.snoozedMs ?? 0;
  const activeMs = effectiveMaterializedElapsedMs({
    startedAt: incident.createdAt,
    evaluationAt: incident.resolvedAt,
    pausedMs: incident.slaPausedMs ?? snooze,
    pauseStartedAt: incident.slaPauseStartedAt,
  });
  const resolveTimeMinutes = activeMs / 1000 / 60;
  const target = getPrioritySLATarget(incident.priority, service);
  return resolveTimeMinutes <= target.resolve;
}
