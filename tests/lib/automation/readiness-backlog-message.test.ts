import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTOMATION_READINESS_POLICY,
  describeObservationBacklog,
} from '@/lib/automation/readiness-policy';

describe('describeObservationBacklog', () => {
  it('states the backlog, the limit and where the limit is changed', () => {
    const message = describeObservationBacklog(
      1,
      DEFAULT_AUTOMATION_READINESS_POLICY.maximumPendingObservations
    );
    expect(message).toContain('at least 1 observation is pending or running');
    expect(message).toContain('the policy allows 0');
    expect(message).toContain(
      'Settings → System → Automation → Shadow readiness → Maximum pending observations'
    );
  });

  it('pluralises and reports a raised limit', () => {
    expect(describeObservationBacklog(6, 5)).toContain(
      'at least 6 observations are pending or running and the policy allows 5'
    );
  });
});
