import { describe, expect, it } from 'vitest';
import { priorityReason } from '@/lib/incidents/priority-reason';

describe('priority reason', () => {
  it('says how the priority was set and which SLA rule applies', () => {
    expect(
      priorityReason({
        priority: 'P1',
        source: 'CLASSIFICATION_RULE',
        rule: 'payments-high',
        slaRule: 'P1 critical',
      })
    ).toBe('Set by rule “payments-high” · SLA rule “P1 critical”');
    expect(priorityReason({ priority: 'P3', source: 'EXPLICIT', rule: null, slaRule: null })).toBe(
      'Set when the incident was created'
    );
    expect(
      priorityReason({ priority: 'P2', source: 'WORKFLOW_STEP', rule: null, slaRule: null })
    ).toBe('Set by workflow step');
  });

  it('says nothing without a priority or a known source', () => {
    expect(
      priorityReason({ priority: null, source: 'CLASSIFICATION_RULE', rule: 'x', slaRule: null })
    ).toBeNull();
    expect(
      priorityReason({ priority: 'P1', source: 'NONE', rule: null, slaRule: null })
    ).toBeNull();
  });
});
