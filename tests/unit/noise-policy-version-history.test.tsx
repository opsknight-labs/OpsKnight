import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NoiseControlVersionView } from '@/lib/intelligence/noise-controls/policy-versions';

vi.mock('@/app/(app)/settings/intelligence/noise-controls/actions', () => {
  const action = vi.fn(async () => ({ message: '', ok: true }));
  return Object.fromEntries(
    [
      'createHeartbeatAction',
      'createRuleAction',
      'createWindowAction',
      'deleteHeartbeatAction',
      'deleteRuleAction',
      'endWindowAction',
      'reverseDecisionAction',
      'rollbackPolicyAction',
      'savePolicyAction',
      'simulateAction',
      'toggleHeartbeatAction',
      'toggleRuleAction',
      'toggleWindowAction',
    ].map(name => [name, action])
  );
});

const { PolicyVersionHistory } = await import('@/components/settings/NoiseControlsForms');

function version(overrides: Partial<NoiseControlVersionView>): NoiseControlVersionView {
  return {
    id: 'v',
    versionNumber: 1,
    mode: 'SHADOW',
    origin: 'PUBLISH',
    checksum: 'a'.repeat(64),
    policyRevision: 1,
    publishedAt: new Date('2026-11-01T10:00:00Z'),
    publishedById: 'u1',
    sourceVersionId: null,
    sourceVersionNumber: null,
    active: false,
    orchestrationRuleCount: 1,
    changes: [],
    changesFromActive: [],
    ...overrides,
  };
}

describe('PolicyVersionHistory', () => {
  const versions = [
    version({
      id: 'v3',
      versionNumber: 3,
      origin: 'ROLLBACK',
      sourceVersionId: 'v1',
      sourceVersionNumber: 1,
      active: true,
      changes: [
        {
          path: 'orchestration.rules[suppress-canary]',
          kind: 'removed',
          summary: 'Rule removed: Suppress canary',
        },
      ],
    }),
    version({
      id: 'v2',
      versionNumber: 2,
      mode: 'ON',
      orchestrationRuleCount: 2,
      changesFromActive: [
        {
          path: 'orchestration.rules[suppress-canary]',
          kind: 'added',
          summary: 'Rule added: Suppress canary',
        },
      ],
    }),
    version({ id: 'v1', versionNumber: 1, origin: 'BACKFILL' }),
  ];

  it('shows the running version, origins, per-version changes and the diff against the running one', () => {
    render(
      <PolicyVersionHistory
        versions={versions}
        serviceId="svc"
        revision={3}
        currentMode="SHADOW"
        canManage
      />
    );
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('rollback of v1')).toBeTruthy();
    expect(screen.getByText('captured from pre-versioning policy')).toBeTruthy();
    expect(screen.getByText(/Rule removed: Suppress canary/)).toBeTruthy();
    expect(screen.getByText(/Rule added: Suppress canary/)).toBeTruthy();
    // Rollback is offered for every version except the running one; rolling back to an ON version
    // from SHADOW needs an explicit acknowledgement.
    expect(screen.queryByRole('button', { name: 'Roll back to v3' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Roll back to v2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Roll back to v1' })).toBeTruthy();
    expect(screen.getAllByText(/I understand this turns noise controls ON/)).toHaveLength(1);
  });

  it('hides rollback for read-only users and explains an empty history', () => {
    const { rerender } = render(
      <PolicyVersionHistory
        versions={versions}
        serviceId={null}
        revision={3}
        currentMode="SHADOW"
        canManage={false}
      />
    );
    expect(screen.queryByRole('button', { name: /Roll back/ })).toBeNull();
    rerender(
      <PolicyVersionHistory
        versions={[]}
        serviceId={null}
        revision={0}
        currentMode="OFF"
        canManage={false}
      />
    );
    expect(screen.getByText(/Publishing the policy above creates version 1/)).toBeTruthy();
  });
});
