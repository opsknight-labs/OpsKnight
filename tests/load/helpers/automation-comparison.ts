import { AUTOMATION_LOAD_PROFILES, type AutomationLoadProfile } from '../fixtures/automation';

export function automationComparisonSchedule(mode: string = 'single') {
  if (mode !== 'single' && mode !== 'interleaved')
    throw new Error('Unknown automation baseline mode');
  const profiles = AUTOMATION_LOAD_PROFILES.filter(
    profile => profile !== 'disabled' && profile !== 'global-off'
  );
  const sequence: AutomationLoadProfile[] =
    mode === 'interleaved'
      ? profiles.flatMap(profile => ['global-off' as const, profile])
      : ['global-off', ...profiles];
  return sequence.map((profile, index) => ({
    profile,
    runId: `${String(index + 1).padStart(2, '0')}-${profile}`,
  }));
}

/** Each enabled profile is compared only to its immediately preceding OFF run. */
export function precedingAutomationBaseline<T extends { profile: string }>(
  results: readonly T[],
  index: number
): T {
  for (let previous = index - 1; previous >= 0; previous--) {
    const result = results.at(previous)!;
    if (result.profile === 'global-off') return result;
  }
  throw new Error('Automation comparison is missing a preceding OFF baseline');
}

/** Repeated bracketing prevents a single moving OFF baseline from certifying capacity. */
export function controlledAutomationSchedule(repetitions = 2) {
  if (!Number.isInteger(repetitions) || repetitions < 2 || repetitions > 3)
    throw new Error('Controlled certification requires two or three repetitions');
  const targets = AUTOMATION_LOAD_PROFILES.filter(p => p !== 'disabled' && p !== 'global-off');
  return Array.from({ length: repetitions }, (_, repetition) =>
    targets.flatMap((target, pairIndex) => {
      const pairId = `repeat-${repetition + 1}-pair-${pairIndex + 1}-${target}`;
      return (['global-off', target, 'global-off'] as AutomationLoadProfile[]).map(
        (profile, index) => ({
          profile,
          pairId,
          repetition: repetition + 1,
          position: index === 0 ? 'OFF_A' : index === 1 ? 'TARGET' : 'OFF_B',
          runId: `${pairId}-${index + 1}-${profile}`,
        })
      );
    })
  ).flat();
}
export function assessControlledAutomationPair(
  before: { p95: number; p99: number },
  target: { p95: number; p99: number },
  after: { p95: number; p99: number }
) {
  if (
    [before, target, after].some(
      v => !Number.isFinite(v.p95) || !Number.isFinite(v.p99) || v.p95 <= 0 || v.p99 <= 0
    )
  )
    return { status: 'INCONCLUSIVE' as const, reason: 'Missing or invalid latency measurements' };
  const p95Drift = Math.max(before.p95, after.p95) / Math.min(before.p95, after.p95) - 1;
  const p99Drift = Math.max(before.p99, after.p99) / Math.min(before.p99, after.p99) - 1;
  // Require the unchanged 1.25x limit against BOTH bracketing baselines.
  // A geometric mean is reported, but cannot hide a failed comparison.
  const p95Ratio = target.p95 / Math.min(before.p95, after.p95);
  const p99Ratio = target.p99 / Math.min(before.p99, after.p99);
  return {
    status:
      p95Drift > 0.15 + Number.EPSILON || p99Drift > 0.2 + Number.EPSILON
        ? ('INCONCLUSIVE' as const)
        : p95Ratio <= 1.25 && p99Ratio <= 1.25
          ? ('PASS' as const)
          : ('FAIL' as const),
    p95Drift,
    p99Drift,
    p95Ratio,
    p99Ratio,
    geometricBaseline: {
      p95: Math.sqrt(before.p95 * after.p95),
      p99: Math.sqrt(before.p99 * after.p99),
    },
  };
}
