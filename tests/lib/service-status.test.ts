import { describe, expect, it } from 'vitest';
import { getServiceDynamicStatus } from '@/lib/service-status';

describe('getServiceDynamicStatus', () => {
  it('returns CRITICAL when critical incidents exist', () => {
    expect(getServiceDynamicStatus({ activeIncidentCount: 0, hasCritical: true })).toBe('CRITICAL');
    expect(getServiceDynamicStatus({ activeIncidentCount: 5, hasCritical: true })).toBe('CRITICAL');
  });

  it('returns DEGRADED when there are open incidents without critical', () => {
    expect(getServiceDynamicStatus({ activeIncidentCount: 1, hasCritical: false })).toBe(
      'DEGRADED'
    );
  });

  it('returns OPERATIONAL when no open incidents exist', () => {
    expect(getServiceDynamicStatus({ activeIncidentCount: 0, hasCritical: false })).toBe(
      'OPERATIONAL'
    );
  });
});
