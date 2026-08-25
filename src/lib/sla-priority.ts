import { Incident, Service } from '@prisma/client';

// Priority-based SLA targets (in minutes)
const PRIORITY_SLA_TARGETS: Record<string, { ack: number; resolve: number }> = {
  P1: { ack: 5, resolve: 60 }, // Critical - 5 min ack, 1 hour resolve
  P2: { ack: 15, resolve: 240 }, // High - 15 min ack, 4 hours resolve
  P3: { ack: 30, resolve: 480 }, // Medium - 30 min ack, 8 hours resolve
  P4: { ack: 60, resolve: 1440 }, // Low - 1 hour ack, 24 hours resolve
  P5: { ack: 120, resolve: 2880 }, // Info - 2 hours ack, 48 hours resolve
};

export type SlaTargetService = {
  targetAckMinutes?: number | null;
  targetResolveMinutes?: number | null;
};

export function getPrioritySLATarget(
  priority: string | null | undefined,
  service: SlaTargetService
): { ack: number; resolve: number } {
  if (priority) {
    const match = priority
      .toUpperCase()
      .trim()
      .match(/^P?([1-5])$/);
    if (match && PRIORITY_SLA_TARGETS[`P${match[1]}`]) {
      return PRIORITY_SLA_TARGETS[`P${match[1]}`];
    }
  }
  // Default to service targets if no priority or priority not found
  return {
    ack: service.targetAckMinutes ?? 15,
    resolve: service.targetResolveMinutes ?? 120,
  };
}

export function checkPriorityAckSLA(
  incident: Incident & { snoozedMs?: number },
  service: SlaTargetService,
  snoozedMs?: number
): boolean {
  if (!incident.acknowledgedAt || !incident.createdAt || !incident.priority) return false;
  const snooze = snoozedMs ?? incident.snoozedMs ?? 0;
  const activeMs = Math.max(
    0,
    incident.acknowledgedAt.getTime() - incident.createdAt.getTime() - snooze
  );
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
  const activeMs = Math.max(
    0,
    incident.resolvedAt.getTime() - incident.createdAt.getTime() - snooze
  );
  const resolveTimeMinutes = activeMs / 1000 / 60;
  const target = getPrioritySLATarget(incident.priority, service);
  return resolveTimeMinutes <= target.resolve;
}
