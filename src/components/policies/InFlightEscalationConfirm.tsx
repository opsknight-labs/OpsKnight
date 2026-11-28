'use client';

import ConfirmDialog from '@/components/ConfirmDialog';

export type InFlightStepChange = 'move' | 'reorder';

const MOVE = { title: 'Move this step?', confirmText: 'Move step' };
const REORDER = { title: 'Reorder steps?', confirmText: 'Reorder steps' };

function midEscalation(count: number): string {
  return count === 1
    ? '1 open incident on this policy is mid-escalation'
    : `${count} open incidents on this policy are mid-escalation`;
}

/** Added to the delete confirmation when incidents are mid-escalation. */
export function inFlightDeleteNotice(count: number): string {
  return `${midEscalation(count)}. They carry on from the step they were waiting for; if that is this step, they move to the next one.`;
}

/** Asks the operator to confirm a move or reorder while incidents are mid-escalation on the policy. */
export default function InFlightEscalationConfirm({
  count,
  change,
  onConfirm,
  onCancel,
}: {
  count: number;
  change: InFlightStepChange;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const copy = change === 'move' ? MOVE : REORDER;
  return (
    <ConfirmDialog
      isOpen
      variant="warning"
      title={copy.title}
      message={`${midEscalation(count)}. They stay on the step they are waiting for. If a step that has not paged yet moves above one that has, the earlier step is paged again rather than skipped.`}
      confirmText={copy.confirmText}
      cancelText="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
