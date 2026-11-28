import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/policies/p1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-product-notification', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import EscalationStepItem from '@/components/policies/EscalationStepItem';
import InFlightEscalationConfirm, {
  inFlightDeleteNotice,
} from '@/components/policies/InFlightEscalationConfirm';
import { useInFlightEscalationGuard } from '@/components/policies/useInFlightEscalationGuard';

describe('InFlightEscalationConfirm', () => {
  it('tells the operator how many incidents are mid-escalation and that a re-page is possible', () => {
    render(
      <InFlightEscalationConfirm count={3} change="reorder" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Reorder steps?');
    expect(dialog).toHaveAccessibleDescription(
      /3 open incidents on this policy are mid-escalation.*paged again rather than skipped/
    );
  });

  it('uses the singular for one incident and the move wording', () => {
    render(
      <InFlightEscalationConfirm count={1} change="move" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Move this step?');
    expect(screen.getByText(/1 open incident on this policy is mid-escalation/)).toBeVisible();
  });

  it('confirms and cancels through its two buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <InFlightEscalationConfirm count={2} change="move" onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Move step' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('inFlightDeleteNotice', () => {
  it('counts the incidents and says they carry on from the step they were waiting for', () => {
    expect(inFlightDeleteNotice(1)).toMatch(/^1 open incident on this policy is mid-escalation\./);
    expect(inFlightDeleteNotice(4)).toMatch(/^4 open incidents on this policy are mid-escalation\./);
    expect(inFlightDeleteNotice(4)).toContain('carry on from the step they were waiting for');
  });
});

describe('useInFlightEscalationGuard', () => {
  function Harness({
    count,
    run,
    onCancel,
  }: {
    count: number;
    run: () => void;
    onCancel: () => void;
  }) {
    const { guard, dialog } = useInFlightEscalationGuard(async () => count);
    return (
      <>
        <button onClick={() => void guard('reorder', run, onCancel)}>go</button>
        {dialog}
      </>
    );
  }

  it('runs straight away, with no dialog, when nothing is mid-escalation', async () => {
    const run = vi.fn();
    render(<Harness count={0} run={run} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('holds the change until the operator confirms', async () => {
    const run = vi.fn();
    const onCancel = vi.fn();
    render(<Harness count={2} run={run} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('go'));
    await screen.findByRole('alertdialog');
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reorder steps' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('drops the change and calls onCancel when the operator cancels', async () => {
    const run = vi.fn();
    const onCancel = vi.fn();
    render(<Harness count={2} run={run} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('go'));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(run).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('EscalationStepItem with incidents mid-escalation', () => {
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

  function setup(count: number) {
    const moveStep = vi.fn(async () => undefined);
    const deleteStep = vi.fn(async () => undefined);
    render(
      <EscalationStepItem
        step={step}
        policyId="p1"
        canManage
        isFirst={false}
        isLast={false}
        updateStep={vi.fn(async () => undefined)}
        deleteStep={deleteStep}
        moveStep={moveStep}
        countInFlight={async () => count}
      />
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for step 2' }), {
      button: 0,
      ctrlKey: false,
    });
    return { moveStep, deleteStep };
  }

  it('moves at once when no incident is mid-escalation', async () => {
    const { moveStep } = setup(0);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move Up/ }));
    await waitFor(() => expect(moveStep).toHaveBeenCalledWith('step-2', 'up'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks first when incidents are mid-escalation, and moves only after confirming', async () => {
    const { moveStep } = setup(3);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move Down/ }));
    await screen.findByRole('alertdialog');
    expect(moveStep).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move step' }));
    await waitFor(() => expect(moveStep).toHaveBeenCalledWith('step-2', 'down'));
  });

  it('does not move when the operator cancels', async () => {
    const { moveStep } = setup(3);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move Up/ }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(moveStep).not.toHaveBeenCalled();
  });

  it('adds the incident count to the delete confirmation', async () => {
    setup(3);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete Step/ }));
    expect(
      await screen.findByText(/3 open incidents on this policy are mid-escalation/)
    ).toBeVisible();
  });

  it('keeps the delete confirmation as it was when none are mid-escalation', async () => {
    setup(0);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete Step/ }));
    expect(await screen.findByText(/This cannot be undone\./)).toBeVisible();
    expect(screen.queryByText(/mid-escalation/)).toBeNull();
  });
});
