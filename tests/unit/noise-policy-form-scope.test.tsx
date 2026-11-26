import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_NOISE_CONTROL_DEFINITION } from '@/lib/intelligence/noise-controls/contract';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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
const { NoisePolicyForm } = await import('@/components/settings/NoiseControlsForms');

const policy = {
  scopeKey: 'global',
  serviceId: null,
  mode: 'SHADOW' as const,
  pipelineOrder: 'OFF' as const,
  definition: DEFAULT_NOISE_CONTROL_DEFINITION,
  revision: 2,
  updatedAt: null,
  versionId: null,
  versionNumber: null,
};

function renderForm() {
  return render(
    <NoisePolicyForm
      policy={policy}
      readiness={{
        ready: false,
        shadowDecisions: 0,
        reversed: 0,
        falsePositiveRate: 0,
        windowDays: 7,
        minimumShadowDecisions: 50,
        maxFalsePositiveRate: 0.02,
      }}
      services={[
        { id: 'svc_checkout', name: 'Checkout' },
        { id: 'svc_search', name: 'Search' },
      ]}
      policies={[]}
      selectedServiceId={null}
      canManage
    />
  );
}

describe('noise policy form scope', () => {
  it('reloads for the chosen service instead of publishing the shown policy revision to it', () => {
    renderForm();
    const select = screen.getByLabelText('Service');
    fireEvent.change(select, { target: { value: 'svc_checkout' } });
    expect(push).toHaveBeenCalledWith('/settings/intelligence/noise-controls?service=svc_checkout');
    fireEvent.change(select, { target: { value: '' } });
    expect(push).toHaveBeenLastCalledWith('/settings/intelligence/noise-controls');
  });
});
