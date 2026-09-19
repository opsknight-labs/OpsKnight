import type { FrameworkRequirement, RequirementLifecycle } from './types';

/**
 * Resolves the active lifecycle state of a framework requirement based on reference dates.
 * Supports future-effective requirements (such as DPDP 2025 staged commencement) and superseded requirements.
 */
export function resolveRequirementLifecycle(
  requirement: FrameworkRequirement,
  now: Date = new Date()
): RequirementLifecycle {
  if (requirement.lifecycle === 'REFERENCE_ONLY') {
    return 'REFERENCE_ONLY';
  }

  if (requirement.lifecycle === 'SUPERSEDED') {
    return 'SUPERSEDED';
  }

  const currentTime = now.getTime();

  if (requirement.effectiveFrom) {
    const effectiveTime = new Date(requirement.effectiveFrom).getTime();
    if (!isNaN(effectiveTime)) {
      if (currentTime < effectiveTime) {
        return 'FUTURE';
      }
    }
  }

  if (requirement.effectiveUntil) {
    const untilTime = new Date(requirement.effectiveUntil).getTime();
    if (!isNaN(untilTime) && currentTime > untilTime) {
      return 'SUPERSEDED';
    }
  }

  if (requirement.effectiveFrom) {
    return 'ACTIVE';
  }

  return requirement.lifecycle;
}
