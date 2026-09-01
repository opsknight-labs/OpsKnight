import { describe, expect, it } from 'vitest';
import {
  escalationDueAt,
  escalationLifecycleGate,
  escalationPolicyExhausted,
  nextEscalationStepIndex,
  terminalEscalationStatus,
} from '@/lib/escalation/state';

describe('escalationLifecycleGate', () => {
  it.each([
    ['ACKNOWLEDGED', null, 'STOPPED'],
    ['RESOLVED', null, 'STOPPED'],
    ['OPEN', 'COMPLETED', 'STOPPED'],
    ['SNOOZED', null, 'PAUSED'],
    ['SUPPRESSED', null, 'PAUSED'],
    ['OPEN', 'PAUSED', 'PAUSED'],
    ['OPEN', 'ESCALATING', 'ACTIVE'],
    ['OPEN', null, 'ACTIVE'],
  ])('gates status=%s escalationStatus=%s as %s', (status, escalationStatus, expected) => {
    expect(escalationLifecycleGate({ status, escalationStatus })).toBe(expected);
  });

  it('prefers stopped over paused when both apply', () => {
    // A resolved incident that still carries PAUSED escalation state must not
    // be treated as merely paused and resumable.
    expect(escalationLifecycleGate({ status: 'RESOLVED', escalationStatus: 'PAUSED' })).toBe(
      'STOPPED'
    );
  });
});

describe('nextEscalationStepIndex', () => {
  it('advances while steps remain', () => {
    expect(nextEscalationStepIndex(0, 3)).toBe(1);
    expect(nextEscalationStepIndex(1, 3)).toBe(2);
  });

  it('never rewinds to step 0 once the policy is spent', () => {
    expect(nextEscalationStepIndex(2, 3)).toBeNull();
    expect(nextEscalationStepIndex(0, 1)).toBeNull();
  });

  it('handles a policy whose steps disappeared underneath it', () => {
    expect(nextEscalationStepIndex(4, 0)).toBeNull();
  });
});

describe('escalationPolicyExhausted', () => {
  it.each([
    [0, 3, false],
    [2, 3, false],
    [3, 3, true],
    [9, 3, true],
    [0, 0, true],
  ])('cursor %i of %i steps -> %s', (stepIndex, stepCount, expected) => {
    expect(escalationPolicyExhausted(stepIndex, stepCount)).toBe(expected);
  });
});

describe('escalationDueAt', () => {
  const now = new Date('2026-05-01T10:00:00.000Z');

  it('adds the delay in minutes', () => {
    expect(escalationDueAt(now, 15)).toEqual(new Date('2026-05-01T10:15:00.000Z'));
  });

  it('treats a missing or negative delay as immediate', () => {
    expect(escalationDueAt(now, null)).toEqual(now);
    expect(escalationDueAt(now, undefined)).toEqual(now);
    expect(escalationDueAt(now, -30)).toEqual(now);
  });
});

describe('terminalEscalationStatus', () => {
  it('completes when responders were reached and fails when none were', () => {
    expect(terminalEscalationStatus(true)).toBe('COMPLETED');
    expect(terminalEscalationStatus(false)).toBe('FAILED');
  });
});
