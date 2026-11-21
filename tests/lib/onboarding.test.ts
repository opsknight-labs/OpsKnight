import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { buildOnboardingSteps } from '@/lib/onboarding';

describe('buildOnboardingSteps', () => {
  it('marks steps done only when counts are above zero (teammate needs a second user)', () => {
    const steps = buildOnboardingSteps({
      services: 2,
      integrations: 0,
      schedules: 1,
      policies: 0,
      users: 1,
    });
    expect(steps.map(s => [s.id, s.done])).toEqual([
      ['service', true],
      ['integration', false],
      ['schedule', true],
      ['policy', false],
      ['teammate', false],
    ]);
    expect(
      buildOnboardingSteps({ services: 0, integrations: 0, schedules: 0, policies: 0, users: 2 })[4]
        .done
    ).toBe(true);
  });
});
