import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  discoverSubjectErasureData: vi.fn(),
}));

vi.mock('@/lib/privacy/erasure/discover', () => ({
  discoverSubjectErasureData: mocks.discoverSubjectErasureData,
}));

import { buildSubjectErasurePlan } from '@/lib/privacy/erasure/plan';
import { ERASURE_DOMAIN_POLICY } from '@/lib/privacy/erasure/policy';

const SUBJECT_ID = 'cuserA0000001';

describe('buildSubjectErasurePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps every policy domain to a count, defaulting to 0 when absent from discovery', async () => {
    mocks.discoverSubjectErasureData.mockResolvedValue({
      subjectId: SUBJECT_ID,
      email: 'alice@example.com',
      domainCounts: { assignedIncidents: 3 },
      dependencyReport: {},
      blockingConditions: [],
    });

    const plan = await buildSubjectErasurePlan(SUBJECT_ID);

    expect(plan.domains).toHaveLength(ERASURE_DOMAIN_POLICY.length);
    const assigned = plan.domains.find(d => d.id === 'assignedIncidents');
    expect(assigned?.count).toBe(3);
    const untouched = plan.domains.find(d => d.id === 'dashboards');
    expect(untouched?.count).toBe(0);
  });

  it('is executable only when there are no blocking conditions', async () => {
    mocks.discoverSubjectErasureData.mockResolvedValue({
      subjectId: SUBJECT_ID,
      email: null,
      domainCounts: {},
      dependencyReport: {},
      blockingConditions: [],
    });

    const plan = await buildSubjectErasurePlan(SUBJECT_ID);
    expect(plan.canExecute).toBe(true);
    expect(plan.blockingConditions).toEqual([]);
  });

  it('is not executable when blocking conditions are present', async () => {
    mocks.discoverSubjectErasureData.mockResolvedValue({
      subjectId: SUBJECT_ID,
      email: null,
      domainCounts: {},
      dependencyReport: {},
      blockingConditions: ['Cannot erase the last active admin.'],
    });

    const plan = await buildSubjectErasurePlan(SUBJECT_ID);
    expect(plan.canExecute).toBe(false);
    expect(plan.blockingConditions).toEqual(['Cannot erase the last active admin.']);
  });
});
