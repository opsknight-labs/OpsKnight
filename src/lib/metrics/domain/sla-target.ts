export type SlaTargetSource = 'definition' | 'priority' | 'service' | 'global';
export type SlaTarget = { ackTargetMs: number; resolveTargetMs: number; source: SlaTargetSource };

export const MINUTE_MS = 60_000;
export const PRIORITY_SLA_TARGETS = [
  { priority: 'P1', ackMinutes: 5, resolveMinutes: 60 },
  { priority: 'P2', ackMinutes: 15, resolveMinutes: 240 },
  { priority: 'P3', ackMinutes: 30, resolveMinutes: 480 },
  { priority: 'P4', ackMinutes: 60, resolveMinutes: 1440 },
  { priority: 'P5', ackMinutes: 120, resolveMinutes: 2880 },
] as const;

function normalizePriority(priority?: string | null): string | null {
  const match = priority
    ?.trim()
    .toUpperCase()
    .match(/^P?([1-5])$/);
  return match ? `P${match[1]}` : null;
}

export function resolveSlaTarget(input: {
  priority?: string | null;
  serviceTargets?: { ackMinutes?: number | null; resolveMinutes?: number | null };
  definitionOverride?: { ackMinutes?: number | null; resolveMinutes?: number | null } | null;
  globalDefaults?: { ackMinutes: number; resolveMinutes: number };
}): SlaTarget {
  const defaults = input.globalDefaults ?? { ackMinutes: 15, resolveMinutes: 120 };
  const override = input.definitionOverride;
  if (override?.ackMinutes != null || override?.resolveMinutes != null) {
    return {
      ackTargetMs: (override.ackMinutes ?? defaults.ackMinutes) * MINUTE_MS,
      resolveTargetMs: (override.resolveMinutes ?? defaults.resolveMinutes) * MINUTE_MS,
      source: 'definition',
    };
  }
  const priority = normalizePriority(input.priority);
  if (priority) {
    const target = PRIORITY_SLA_TARGETS.find(candidate => candidate.priority === priority);
    if (!target) throw new Error(`Unsupported normalized SLA priority: ${priority}`);
    return {
      ackTargetMs: target.ackMinutes * MINUTE_MS,
      resolveTargetMs: target.resolveMinutes * MINUTE_MS,
      source: 'priority',
    };
  }
  const service = input.serviceTargets;
  if (service?.ackMinutes != null || service?.resolveMinutes != null) {
    return {
      ackTargetMs: (service.ackMinutes ?? defaults.ackMinutes) * MINUTE_MS,
      resolveTargetMs: (service.resolveMinutes ?? defaults.resolveMinutes) * MINUTE_MS,
      source: 'service',
    };
  }
  return {
    ackTargetMs: defaults.ackMinutes * MINUTE_MS,
    resolveTargetMs: defaults.resolveMinutes * MINUTE_MS,
    source: 'global',
  };
}
