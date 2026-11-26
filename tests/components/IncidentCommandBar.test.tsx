import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: { error: mocks.error, success: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/app/(app)/incidents/snooze-actions', () => ({ snoozeIncidentWithDuration: vi.fn() }));
vi.mock('@/app/(app)/incidents/jira/actions', () => ({
  createJiraIssueFromIncident: vi.fn(),
  linkJiraIssueToIncident: vi.fn(),
  unlinkJiraIssueFromIncident: vi.fn(),
  syncIncidentJiraIssue: vi.fn(),
}));
vi.mock('@/components/incident/war-room/WarRoomLauncher', () => ({ WarRoomLauncher: () => null }));
vi.mock('@/components/incident/ResolveIncidentModal', () => ({ default: () => null }));
vi.mock('@/components/incident/detail/SnoozeDurationDialog', () => ({ default: () => null }));
vi.mock('@/components/incident/detail/IncidentTags', () => ({ default: () => null }));
vi.mock('@/components/incident/detail/StatusUpdateAction', () => ({ default: () => null }));

import IncidentCommandBar from '@/components/incident/detail/IncidentCommandBar';

const noop = vi.fn();

function renderBar(overrides: Partial<React.ComponentProps<typeof IncidentCommandBar>>) {
  return render(
    <IncidentCommandBar
      incidentId="inc-1"
      currentStatus="OPEN"
      canManage
      canAcknowledge
      snoozedUntil={null}
      onAcknowledge={noop}
      onUnacknowledge={noop}
      onUnsnooze={noop}
      onSuppress={noop}
      onUnsuppress={noop}
      resolvingIncident={{} as never}
      postmortemHref="/postmortems/inc-1"
      postmortemExists={false}
      jiraCapability={{} as never}
      {...overrides}
    />
  );
}

beforeEach(() => mocks.error.mockReset());

it('shows a toast instead of throwing when acknowledging fails', async () => {
  const onAcknowledge = vi.fn().mockRejectedValue(new Error('Transition conflict'));
  renderBar({ onAcknowledge });

  fireEvent.click(screen.getAllByRole('button', { name: /^Acknowledge$/ })[0]);

  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(onAcknowledge).toHaveBeenCalledTimes(1);
});

it('shows a toast instead of throwing when Suppress from the overflow menu fails', async () => {
  const onSuppress = vi.fn().mockRejectedValue(new Error('Transition conflict'));
  renderBar({ onSuppress });

  // Radix opens its menu on pointerdown, not click.
  fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More incident actions' })[0], {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('menuitem', { name: /Suppress/ }));

  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(onSuppress).toHaveBeenCalledTimes(1);
});
