import { describe, expect, it } from 'vitest';
import { normalizeWorkspaceClassificationPolicyInput } from '@/lib/incidents/classification-policy';

describe('legacy workspace classification input', () => {
  it('preserves urgency-derived priority fallback for an old payload', () => {
    const input = normalizeWorkspaceClassificationPolicyInput({
      expectedVersion: 0,
      derivePriorityFromUrgency: true,
      rules: [
        { matchValue: 'critical', priority: null, urgency: 'HIGH' },
        { matchValue: 'error', priority: null, urgency: 'MEDIUM' },
        { matchValue: 'warning', priority: null, urgency: 'MEDIUM' },
        { matchValue: 'info', priority: null, urgency: 'LOW' },
      ],
    }) as unknown as { rules: Array<{ priorityMode: string; urgencyMode: string }> };

    expect(input.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priorityMode: 'FALLBACK', urgencyMode: 'SET' }),
      ])
    );
  });

  it('normalizes null urgency from an old payload to DEFAULT', () => {
    const input = normalizeWorkspaceClassificationPolicyInput({
      expectedVersion: 0,
      derivePriorityFromUrgency: false,
      rules: [
        { matchValue: 'critical', priority: null, urgency: null },
        { matchValue: 'error', priority: null, urgency: null },
        { matchValue: 'warning', priority: null, urgency: null },
        { matchValue: 'info', priority: null, urgency: null },
      ],
    }) as unknown as { rules: Array<{ priorityMode: string; urgencyMode: string }> };

    expect(input.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priorityMode: 'CLEAR', urgencyMode: 'DEFAULT' }),
      ])
    );
  });
});
