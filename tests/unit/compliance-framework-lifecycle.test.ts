import { describe, expect, it } from 'vitest';
import { detectFrameworkLifecycleTransitions } from '@/lib/compliance/drift/framework-lifecycle';

describe('detectFrameworkLifecycleTransitions', () => {
  it('returns no transitions when dates are identical', () => {
    const d = new Date('2026-09-20T10:00:00.000Z');
    const transitions = detectFrameworkLifecycleTransitions(d, d);
    expect(transitions).toHaveLength(0);
  });

  it('detects FUTURE to ACTIVE transitions across staged enforcement dates', () => {
    // DPDP staged date or CRA staged date
    const beforeStaged = new Date('2024-01-01T00:00:00.000Z');
    const afterStaged = new Date('2028-01-01T00:00:00.000Z');

    const transitions = detectFrameworkLifecycleTransitions(beforeStaged, afterStaged);
    expect(transitions.length).toBeGreaterThan(0);

    const dpdpOrCra = transitions.find(
      t => t.previousLifecycle === 'FUTURE' && t.currentLifecycle === 'ACTIVE'
    );
    expect(dpdpOrCra).toBeDefined();
    expect(dpdpOrCra?.requirementId).toBeTruthy();
    expect(dpdpOrCra?.framework).toBeTruthy();
  });
});
