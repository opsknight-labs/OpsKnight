import { describe, expect, it } from 'vitest';
import {
  kubernetesRecoveryTargets,
  requireRecoveryTarget,
} from '../load/helpers/automation-recovery';

describe('automation capacity recovery drill', () => {
  it('targets a single physical integrated replica covering all runtime roles', () => {
    const targets = kubernetesRecoveryTargets('integrated');
    expect(targets).toHaveLength(1);
    expect(targets[0].selector).toContain('app.kubernetes.io/name=opsknight');
    expect(targets[0].selector).toContain('app.kubernetes.io/instance=automation');
  });
  it('targets each split runtime role within the certification release', () => {
    const targets = kubernetesRecoveryTargets();
    expect(targets.map(target => target.role)).toEqual(['web', 'critical', 'general']);
    expect(new Set(targets.map(target => target.selector)).size).toBe(3);
    expect(
      targets.every(target => target.selector.includes('app.kubernetes.io/instance=automation'))
    ).toBe(true);
  });
  it('rejects an unknown topology and missing replicas rather than skipping the drill', () => {
    expect(() => kubernetesRecoveryTargets('typo')).toThrow('Unsupported recovery');
    expect(() => requireRecoveryTarget('  ', 'critical')).toThrow('could not find');
    expect(requireRecoveryTarget(' pod-123\n', 'integrated')).toBe('pod-123');
  });
});
