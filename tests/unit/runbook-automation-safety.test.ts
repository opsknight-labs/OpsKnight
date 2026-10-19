import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));

import {
  bindingAuthorizesUnattendedWrites,
  summarizeUnattendedWriteEligibility,
} from '@/lib/runbooks/bindings';
import { decideRecovery, type RecoveryWriteAction } from '@/lib/runbooks/recovery';
import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';

const check = (key: string): RunbookStepDefinition => ({
  key,
  name: `Check ${key}`,
  type: 'SYSTEMD',
  riskClass: 'READ_ONLY',
  config: { action: 'status', unit: 'api.service' },
});

const restart = (
  key: string,
  overrides: Partial<RunbookStepDefinition> = {}
): RunbookStepDefinition => ({
  key,
  name: `Restart ${key}`,
  type: 'SYSTEMD',
  riskClass: 'IDEMPOTENT_WRITE',
  config: { action: 'start', unit: 'api.service' },
  ...overrides,
});

describe('summarizeUnattendedWriteEligibility', () => {
  it('is eligible when every write action authors verification', () => {
    const definition: RunbookDefinition = {
      steps: [check('pre'), restart('restart', { verification: { steps: [check('verify')] } })],
    };
    expect(summarizeUnattendedWriteEligibility(definition)).toEqual({
      eligible: true,
      reasons: [],
      writeActions: [
        {
          key: 'restart',
          name: 'Restart restart',
          type: 'SYSTEMD',
          riskClass: 'IDEMPOTENT_WRITE',
          hasVerification: true,
          alwaysRequiresApproval: false,
        },
      ],
    });
  });

  it('rejects write actions without verification', () => {
    const result = summarizeUnattendedWriteEligibility({
      steps: [restart('a', { verification: { steps: [check('va')] } }), restart('b')],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      expect.stringContaining(
        'UNATTENDED_WRITE_VERIFICATION_REQUIRED: Write action "Restart b" (b)'
      ),
    ]);
    expect(result.writeActions.map(action => [action.key, action.hasVerification])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('lists NON_IDEMPOTENT and explicitly gated actions as always requiring approval', () => {
    const result = summarizeUnattendedWriteEligibility({
      steps: [
        restart('ni', {
          riskClass: 'NON_IDEMPOTENT',
          verification: { steps: [check('v1')] },
        }),
        restart('gated', { requiresApproval: true, verification: { steps: [check('v2')] } }),
        restart('free', { verification: { steps: [check('v3')] } }),
      ],
    });
    expect(result.eligible).toBe(true);
    expect(result.writeActions.map(action => [action.key, action.alwaysRequiresApproval])).toEqual([
      ['ni', true],
      ['gated', true],
      ['free', false],
    ]);
  });

  it('treats HTTP writes like Agent writes', () => {
    const result = summarizeUnattendedWriteEligibility({
      steps: [
        {
          key: 'hook',
          name: 'Flush cache',
          type: 'HTTP',
          riskClass: 'IDEMPOTENT_WRITE',
          config: { url: 'https://example.com/flush', method: 'PUT' },
        },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.writeActions[0]).toMatchObject({ key: 'hook', type: 'HTTP' });
  });

  it('is not applicable to READ_ONLY-only runbooks', () => {
    const result = summarizeUnattendedWriteEligibility({ steps: [check('only')] });
    expect(result).toMatchObject({ eligible: false, writeActions: [] });
    expect(result.reasons[0]).toContain('UNATTENDED_WRITE_NOT_APPLICABLE');
  });

  it('reports invalid definitions instead of throwing', () => {
    const result = summarizeUnattendedWriteEligibility({ steps: 'nope' });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain('RUNBOOK_DEFINITION_INVALID');
  });
});

describe('bindingAuthorizesUnattendedWrites', () => {
  const authorized = {
    mode: 'AUTOMATIC' as const,
    versionStrategy: 'PINNED' as const,
    runbookVersionId: 'v1',
    unattendedWritesVersionId: 'v1',
    unattendedWritesAuthorizedAt: new Date(),
  };

  it('requires an AUTOMATIC binding authorized for the exact pinned version', () => {
    expect(bindingAuthorizesUnattendedWrites(authorized, 'v1')).toBe(true);
    expect(bindingAuthorizesUnattendedWrites(authorized, 'v2')).toBe(false);
    expect(bindingAuthorizesUnattendedWrites({ ...authorized, mode: 'SUGGESTED' }, 'v1')).toBe(
      false
    );
    expect(
      bindingAuthorizesUnattendedWrites(
        { ...authorized, versionStrategy: 'LATEST_PUBLISHED' },
        'v1'
      )
    ).toBe(false);
    expect(
      bindingAuthorizesUnattendedWrites({ ...authorized, unattendedWritesAuthorizedAt: null }, 'v1')
    ).toBe(false);
    expect(bindingAuthorizesUnattendedWrites({ ...authorized, runbookVersionId: 'v2' }, 'v1')).toBe(
      false
    );
  });
});

describe('decideRecovery', () => {
  const action = (overrides: Partial<RecoveryWriteAction> = {}): RecoveryWriteAction => ({
    key: 'restart',
    name: 'Restart',
    hasVerification: true,
    attempted: true,
    verified: true,
    ...overrides,
  });
  const optedIn = { enabled: true, resolveOnVerifiedRecovery: true };

  it('requests resolution only for a succeeded, fully verified, opted-in incident execution', () => {
    expect(
      decideRecovery({
        executionStatus: 'SUCCEEDED',
        incidentId: 'inc',
        binding: optedIn,
        writeActions: [action(), action({ key: 'b' })],
      })
    ).toEqual({ outcome: 'PENDING', event: 'RUNBOOK_VERIFIED', verifiedCount: 2, writeCount: 2 });
  });

  it('does not resolve when the toggle is off or the binding is disabled', () => {
    for (const binding of [
      { enabled: true, resolveOnVerifiedRecovery: false },
      { enabled: false, resolveOnVerifiedRecovery: true },
      null,
    ]) {
      expect(
        decideRecovery({
          executionStatus: 'SUCCEEDED',
          incidentId: 'inc',
          binding,
          writeActions: [action()],
        })
      ).toMatchObject({ outcome: 'NOT_REQUESTED', event: 'RUNBOOK_VERIFIED' });
    }
  });

  it('never resolves when any write action is unverified', () => {
    expect(
      decideRecovery({
        executionStatus: 'SUCCEEDED',
        incidentId: 'inc',
        binding: optedIn,
        writeActions: [action(), action({ key: 'b', verified: false })],
      })
    ).toEqual({
      outcome: 'NOT_VERIFIED',
      event: 'RUNBOOK_UNVERIFIED',
      verifiedCount: 1,
      writeCount: 2,
    });
    expect(
      decideRecovery({
        executionStatus: 'SUCCEEDED',
        incidentId: 'inc',
        binding: optedIn,
        writeActions: [action({ hasVerification: false, verified: false })],
      })
    ).toMatchObject({ outcome: 'NOT_VERIFIED', event: null });
  });

  it('never resolves READ_ONLY-only runbooks', () => {
    expect(
      decideRecovery({
        executionStatus: 'SUCCEEDED',
        incidentId: 'inc',
        binding: optedIn,
        writeActions: [],
      })
    ).toMatchObject({ outcome: 'NOT_REQUESTED', event: null });
  });

  it('treats non-succeeded executions as not verified', () => {
    for (const executionStatus of ['FAILED', 'TIMED_OUT', 'CANCELLED']) {
      expect(
        decideRecovery({
          executionStatus,
          incidentId: 'inc',
          binding: optedIn,
          writeActions: [action({ verified: false })],
        })
      ).toMatchObject({ outcome: 'NOT_VERIFIED', event: 'RUNBOOK_UNVERIFIED' });
    }
  });

  it('emits no event when no verified write action was attempted', () => {
    expect(
      decideRecovery({
        executionStatus: 'CANCELLED',
        incidentId: 'inc',
        binding: optedIn,
        writeActions: [action({ attempted: false, verified: false })],
      })
    ).toMatchObject({ outcome: 'NOT_VERIFIED', event: null });
  });

  it('never requests resolution without an incident', () => {
    expect(
      decideRecovery({
        executionStatus: 'SUCCEEDED',
        incidentId: null,
        binding: optedIn,
        writeActions: [action()],
      })
    ).toMatchObject({ outcome: 'NOT_REQUESTED', event: null });
  });
});
