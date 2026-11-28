/**
 * The words people see for Intelligence settings, in one place so every screen says the same thing. Internal
 * names (SHADOW, SUGGEST) never appear in the interface; docs and tests use these words too.
 */
import type { IntelligenceModeValue } from '@/lib/intelligence/contract';

/** What Intelligence does for responders (the global or per-service policy mode). */
export const POLICY_MODE_WORD = {
  OFF: 'Off',
  SHADOW: 'Watch only',
  SUGGEST: 'Suggest',
  AUTO: 'Automatic',
} as const satisfies Record<IntelligenceModeValue, string>;

/** What noise controls do to an alert before anyone is paged. */
export const NOISE_MODE_WORD = {
  OFF: 'Off',
  SHADOW: 'Watch only',
  ON: 'On',
} as const;

/** Where a service's policy comes from. */
export const POLICY_SOURCE_WORD = {
  service: 'Own setting',
  global: 'Same as all services',
  default: 'Not set',
} as const;

export function policyModeWord(mode: IntelligenceModeValue): string {
  // eslint-disable-next-line security/detect-object-injection -- mode is the closed IntelligenceModeValue union
  return POLICY_MODE_WORD[mode];
}

export function noiseModeWord(mode: keyof typeof NOISE_MODE_WORD): string {
  // eslint-disable-next-line security/detect-object-injection -- mode is the closed noise mode union
  return NOISE_MODE_WORD[mode];
}

export function policySourceWord(source: keyof typeof POLICY_SOURCE_WORD): string {
  // eslint-disable-next-line security/detect-object-injection -- source is the closed source union
  return POLICY_SOURCE_WORD[source];
}
