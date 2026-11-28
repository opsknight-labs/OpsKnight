import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
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

const readiness = {
  ready: false,
  shadowDecisions: 0,
  reversed: 0,
  falsePositiveRate: 0,
  windowDays: 7,
  minimumShadowDecisions: 50,
  maxFalsePositiveRate: 0.02,
};

function formElement(props: Partial<ComponentProps<typeof NoisePolicyForm>> = {}) {
  return (
    <NoisePolicyForm
      policy={policy}
      readiness={readiness}
      services={[
        { id: 'svc_checkout', name: 'Checkout' },
        { id: 'svc_search', name: 'Search' },
      ]}
      policies={[]}
      selectedServiceId={null}
      canManage
      {...props}
    />
  );
}

const renderForm = (props: Partial<ComponentProps<typeof NoisePolicyForm>> = {}) =>
  render(formElement(props));
const sentFrom = (container: HTMLElement) =>
  new FormData(container.querySelector('form') as HTMLFormElement);

describe('noise policy form scope', () => {
  it('reloads for the chosen service instead of publishing the shown policy revision to it', () => {
    renderForm();
    const select = screen.getByLabelText('Service');
    fireEvent.change(select, { target: { value: 'svc_checkout' } });
    expect(push).toHaveBeenCalledWith('/settings/intelligence/noise-controls?service=svc_checkout');
    fireEvent.change(select, { target: { value: '' } });
    expect(push).toHaveBeenLastCalledWith('/settings/intelligence/noise-controls');
  });

  it('submits the scope and revision it was rendered with, even while a navigation is pending', () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc_checkout' } });
    const sent = new FormData(container.querySelector('form') as HTMLFormElement);
    // Publishing before the page for Checkout has loaded must not send the global revision for Checkout.
    expect(sent.get('serviceId')).toBe('');
    expect(sent.get('expectedRevision')).toBe('2');
  });

  // Saving ON used to leave the form showing OFF (it kept the values it was first rendered with), so a second
  // publish quietly put the mode back.
  it('shows the mode that was just published instead of the one the form first loaded with', () => {
    const { rerender, container } = renderForm();
    expect(screen.getByRole('radio', { name: /^Watch only/ })).toBeChecked();
    rerender(formElement({ policy: { ...policy, mode: 'ON', revision: 3 } }));
    expect(screen.getByRole('radio', { name: /^On/ })).toBeChecked();
    expect(sentFrom(container).get('mode')).toBe('ON');
    expect(sentFrom(container).get('expectedRevision')).toBe('3');
  });

  it('asks for the acknowledgement only when turning ON without enough evidence', () => {
    const { container } = renderForm();
    expect(screen.queryByLabelText(/I understand: turn ON/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^On/ }));
    fireEvent.click(screen.getByLabelText(/I understand: turn ON/));
    const sent = sentFrom(container);
    expect(sent.get('mode')).toBe('ON');
    expect(sent.get('acknowledgeReadiness')).toBe('on');
    fireEvent.click(screen.getByRole('radio', { name: /^Watch only/ }));
    expect(screen.queryByLabelText(/I understand: turn ON/)).not.toBeInTheDocument();
    expect(sentFrom(container).get('acknowledgeReadiness')).toBeNull();
  });

  it('does not ask for the acknowledgement when there is enough evidence, or it is already ON', () => {
    renderForm({ readiness: { ...readiness, ready: true } });
    fireEvent.click(screen.getByRole('radio', { name: /^On/ }));
    expect(screen.queryByLabelText(/I understand: turn ON/)).not.toBeInTheDocument();
  });

  it('still submits the folded-away numbers', () => {
    const { container } = renderForm();
    const sent = sentFrom(container);
    for (const name of [
      'contentDedupWindowSeconds',
      'flappingWindowSeconds',
      'flappingThreshold',
      'stormThreshold',
      'stormWindowSeconds',
      'stormHoldSeconds',
      'pipelineOrder',
    ])
      expect(sent.get(name), name).not.toBeNull();
  });
});
