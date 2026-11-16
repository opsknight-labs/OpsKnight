import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/policies/p1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-product-notification', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import StepOutcomeStrip from '@/components/policies/StepOutcomeStrip';
import PolicyDetailTabs from '@/components/policies/PolicyDetailTabs';
import EscalationStepItem from '@/components/policies/EscalationStepItem';

const step = {
  id: 'step-2',
  stepOrder: 1,
  delayMinutes: 15,
  targetType: 'USER' as const,
  targetUserId: 'u1',
  targetUser: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  targetTeam: null,
  targetSchedule: null,
  notifyOnlyTeamLead: false,
  notificationChannels: [],
};
const noop = vi.fn(async () => undefined);
const itemProps = {
  step,
  policyId: 'p1',
  isFirst: false,
  isLast: true,
  updateStep: noop,
  deleteStep: noop,
  moveStep: noop,
};

describe('StepOutcomeStrip', () => {
  it('says pages, acknowledgement rate and median in one line', () => {
    render(<StepOutcomeStrip stat={{ paged: 12, ackRate: 0.75, medianAckMinutes: 4 }} />);
    expect(
      screen.getByText(/12 pages · 75% acknowledged here · median ack 4 min/)
    ).toBeVisible();
  });

  it('renders nothing without data', () => {
    const { container } = render(<StepOutcomeStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('handles no acknowledgements and slow ones', () => {
    const { rerender } = render(
      <StepOutcomeStrip stat={{ paged: 1, ackRate: 0, medianAckMinutes: null }} />
    );
    expect(screen.getByText(/1 page · 0% acknowledged here$/)).toBeVisible();
    rerender(<StepOutcomeStrip stat={{ paged: 3, ackRate: 1, medianAckMinutes: 121 }} />);
    expect(screen.getByText(/median ack over 2 h/)).toBeVisible();
  });
});

describe('PolicyDetailTabs insights tab', () => {
  const base = {
    stepCount: 1,
    serviceCount: 0,
    activityCount: 0,
    steps: <p>steps</p>,
    services: null,
    activity: null,
    settings: null,
  };

  it('is absent while there is no open insight', () => {
    render(<PolicyDetailTabs {...base} insightCount={0} insights={<p>list</p>} />);
    expect(screen.queryByRole('tab', { name: /Insights/ })).toBeNull();
  });

  it('appears with its count when there are insights', () => {
    render(<PolicyDetailTabs {...base} insightCount={2} insights={<p>list</p>} />);
    expect(screen.getByRole('tab', { name: /Insights/ })).toHaveTextContent('2');
  });
});

describe('Apply suggestion', () => {
  it('opens the step editor with the suggested wait filled in, without saving', () => {
    render(<EscalationStepItem {...itemProps} canManage suggestedDelayMinutes={6} />);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByDisplayValue('6')).toBeVisible();
    expect(noop).not.toHaveBeenCalled();
  });

  it('does not open for someone who cannot edit the policy', () => {
    render(<EscalationStepItem {...itemProps} canManage={false} suggestedDelayMinutes={6} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the step strip under the target', () => {
    render(
      <EscalationStepItem
        {...itemProps}
        canManage={false}
        stat={{ paged: 5, ackRate: 0.4, medianAckMinutes: 10 }}
      />
    );
    expect(screen.getByText(/5 pages · 40% acknowledged here/)).toBeVisible();
  });
});
