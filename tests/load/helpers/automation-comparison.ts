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
