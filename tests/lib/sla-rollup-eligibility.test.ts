import { describe, expect, it } from 'vitest';
import { isRollupCompatibleIncidentFilter } from '@/lib/metrics/domain/rollup-eligibility';

describe('isRollupCompatibleIncidentFilter', () => {
  it.each([
    ['priority scalar', { priority: 'P1' }],
    ['priority list', { priority: ['P1', 'P2'] }],
    ['team', { teamId: 'team-1' }],
    ['urgency', { urgency: 'HIGH' as const }],
    ['assigned user', { assigneeId: 'user-1' }],
    ['unassigned user', { assigneeId: null }],
    ['status', { status: 'RESOLVED' as const }],
    ['private visibility', { visibility: 'PRIVATE' as const }],
  ])('routes %s filters to the exact live path', (_label, filter) => {
    expect(isRollupCompatibleIncidentFilter(filter)).toBe(false);
  });

  it.each([
    ['no filters', {}],
    ['service scalar', { serviceId: 'service-1' }],
    ['service list', { serviceId: ['service-1', 'service-2'] }],
    ['explicit all visibility', { visibility: 'ALL' as const }],
  ])('allows complete rollup dimensions for %s', (_label, filter) => {
    expect(isRollupCompatibleIncidentFilter(filter)).toBe(true);
  });
});
