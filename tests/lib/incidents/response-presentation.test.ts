import { describe, expect, it } from 'vitest';
import {
  clipText,
  HUMAN_INTERVENTION_PREFIX,
  isRunbookEventType,
  parseRecoveryOutcome,
  recoveryOutcomePresentation,
  RESOLUTION_RECOMMENDED_PREFIX,
  runbookEventDisplay,
  runbookEventPresentation,
  runbookEventSignal,
  summarizeExecutionTarget,
  summarizeExecutionVerification,
  verificationStatePresentation,
} from '@/lib/incidents/response-presentation';

describe('runbook recovery signals', () => {
  it('detects human intervention and resolution recommendations by event type and prefix', () => {
    expect(
      runbookEventSignal('RUNBOOK_UNVERIFIED', `${HUMAN_INTERVENTION_PREFIX}: nobody paged`)
    ).toBe('HUMAN_INTERVENTION');
    expect(
      runbookEventSignal('RUNBOOK_VERIFIED', `Verified. ${RESOLUTION_RECOMMENDED_PREFIX}: resolve`)
    ).toBe('RESOLUTION_RECOMMENDED');
    // The prefix on a different event type is not a signal.
    expect(runbookEventSignal('RUNBOOK_FAILED', `${HUMAN_INTERVENTION_PREFIX}: x`)).toBeNull();
    expect(runbookEventSignal('RUNBOOK_VERIFIED', 'Recovery verified')).toBeNull();
    expect(runbookEventDisplay('RUNBOOK_UNVERIFIED', `${HUMAN_INTERVENTION_PREFIX}: x`)).toEqual({
      label: 'Human intervention required',
      tone: 'critical',
    });
    expect(runbookEventDisplay('RUNBOOK_VERIFIED', 'Recovery verified')).toEqual(
      runbookEventPresentation('RUNBOOK_VERIFIED')
    );
  });
});

const verified = (value: boolean) => ({
  verified: value,
  checkKeys: ['verify'],
  capturedAt: '2026-10-19T10:00:00.000Z',
  reason: value ? 'ok' : 'still failing',
  differences: [],
});

describe('response presentation helpers', () => {
  it('recognizes the new runbook incident event types', () => {
    for (const type of ['RUNBOOK_SKIPPED', 'RUNBOOK_VERIFIED', 'RUNBOOK_UNVERIFIED'] as const) {
      expect(isRunbookEventType(type)).toBe(true);
    }
    expect(runbookEventPresentation('RUNBOOK_SKIPPED')).toEqual({
      label: 'Runbook skipped',
      tone: 'warning',
    });
    expect(runbookEventPresentation('RUNBOOK_VERIFIED').tone).toBe('success');
    expect(runbookEventPresentation('RUNBOOK_UNVERIFIED').label).toBe('Recovery not verified');
    expect(isRunbookEventType('ACKNOWLEDGED')).toBe(false);
    expect(isRunbookEventType(null)).toBe(false);
  });

  it('parses recovery outcomes defensively', () => {
    expect(parseRecoveryOutcome('BLOCKED')).toBe('BLOCKED');
    expect(parseRecoveryOutcome('bogus')).toBeNull();
    expect(parseRecoveryOutcome(null)).toBeNull();
    expect(recoveryOutcomePresentation('RESOLVED').tone).toBe('success');
    expect(recoveryOutcomePresentation('BLOCKED').tone).toBe('critical');
  });

  it('summarizes context targeting and redacts derived values for non-sensitive viewers', () => {
    const selection = {
      selector: { host: '${{ context.host }}', zone: '${{ incident.labels.zone }}', role: 'web' },
      resolvedLabels: { host: 'web-01', zone: 'eu-1', role: 'web' },
      contextKeys: ['host'],
      poolId: 'pool-1',
    };
    expect(summarizeExecutionTarget(selection, true)).toEqual({
      labels: [
        { key: 'host', value: 'web-01', fromContext: true },
        { key: 'role', value: 'web', fromContext: false },
        { key: 'zone', value: 'eu-1', fromContext: false },
      ],
      contextKeys: ['host'],
      poolId: 'pool-1',
      implicitLocalHost: false,
    });
    expect(summarizeExecutionTarget(selection, false).labels).toEqual([
      { key: 'host', value: null, fromContext: true },
      { key: 'role', value: 'web', fromContext: false },
      { key: 'zone', value: null, fromContext: false },
    ]);
  });

  it('accepts the legacy target selection shape and malformed input', () => {
    expect(
      summarizeExecutionTarget(
        {
          selector: { region: '${{ context.region }}' },
          resolvedSelector: { region: 'eu' },
          sourcePoolId: 'pool-legacy',
          implicitLocalHost: true,
        },
        true
      )
    ).toEqual({
      labels: [{ key: 'region', value: 'eu', fromContext: true }],
      contextKeys: ['region'],
      poolId: 'pool-legacy',
      implicitLocalHost: true,
    });
    expect(summarizeExecutionTarget('garbage', true)).toEqual({
      labels: [],
      contextKeys: [],
      poolId: null,
      implicitLocalHost: false,
    });
    expect(summarizeExecutionTarget({ selector: 42 }, true).labels).toEqual([]);
  });

  it('classifies write-action verification', () => {
    const step = (id: string, riskClass: string, verificationResult: unknown) => ({
      id,
      stepKey: id,
      name: id,
      riskClass,
      status: 'SUCCEEDED',
      verificationResult,
    });
    expect(summarizeExecutionVerification([step('r', 'READ_ONLY', null)]).state).toBe('NONE');
    expect(
      summarizeExecutionVerification([
        step('a', 'IDEMPOTENT_WRITE', verified(true)),
        step('b', 'NON_IDEMPOTENT', verified(true)),
      ]).state
    ).toBe('VERIFIED');
    const partial = summarizeExecutionVerification([
      step('a', 'IDEMPOTENT_WRITE', verified(true)),
      step('b', 'IDEMPOTENT_WRITE', verified(false)),
      step('c', 'IDEMPOTENT_WRITE', null),
    ]);
    expect(partial).toMatchObject({
      state: 'PARTIAL',
      verifiedCount: 1,
      unverifiedCount: 1,
      pendingCount: 1,
    });
    expect(
      summarizeExecutionVerification([step('a', 'IDEMPOTENT_WRITE', verified(false))]).state
    ).toBe('UNVERIFIED');
    expect(
      summarizeExecutionVerification([step('a', 'IDEMPOTENT_WRITE', { verified: 'yes' })]).state
    ).toBe('PENDING');
    expect(verificationStatePresentation('PARTIAL').tone).toBe('warning');
  });

  it('clips long values and strips control characters', () => {
    expect(clipText('a\u0000b\u0007c')).toBe('abc');
    expect(clipText('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
