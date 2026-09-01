export type SlaTargetSource = 'definition' | 'priority' | 'service' | 'global';
export type SlaTarget = { ackTargetMs: number; resolveTargetMs: number; source: SlaTargetSource };

const MINUTE_MS = 60_000;
const PRIORITY_TARGETS: Record<string, { ack: number; resolve: number }> = {
  P1: { ack: 5, resolve: 60 },
  P2: { ack: 15, resolve: 240 },
  P3: { ack: 30, resolve: 480 },
  P4: { ack: 60, resolve: 1440 },
  P5: { ack: 120, resolve: 2880 },
};

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
    const target = PRIORITY_TARGETS[priority];
    return {
      ackTargetMs: target.ack * MINUTE_MS,
      resolveTargetMs: target.resolve * MINUTE_MS,
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
