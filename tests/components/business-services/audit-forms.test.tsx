import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: notifyMock }));

const notifyStakeholders = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/stakeholder-actions', () => ({
  notifyStakeholdersAction: notifyStakeholders,
}));
vi.mock('@/app/(app)/services/business/actions', () => ({
  createBusinessServiceAction: vi.fn(),
  updateBusinessServiceAction: vi.fn(),
  deleteBusinessServiceAction: vi.fn(),
  previewBusinessServiceImpactAction: vi.fn(),
  unmarkImpactAction: vi.fn(),
  followBusinessServiceAction: vi.fn(),
}));
vi.mock('@/app/(app)/services/business/phase5b-actions', () => ({
  unmarkImpactAction: vi.fn(),
}));

import NotifyStakeholdersButton from '@/components/incident/detail/NotifyStakeholdersButton';
import { mapServerErrors } from '@/components/service/BusinessServiceForm';
import ImpactTimeline from '@/components/business-service/ImpactTimeline';
import type { ImpactTimelineEntry } from '@/lib/business-services/contract';

beforeEach(() => vi.clearAllMocks());

describe('NotifyStakeholdersButton', () => {
  it('keeps "$&" in a service name literal in the seeded message', async () => {
    render(
      <NotifyStakeholdersButton incidentId="i1" businessServices={[{ id: 'b', name: 'Pay$&Go' }]} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Notify stakeholders/ }));
    const message = (await screen.findByLabelText('Message')) as HTMLTextAreaElement;
    expect(message.value).toContain('Pay$&Go');
  });

  it('sends the edited message and clears an old error when it is edited', async () => {
    notifyStakeholders.mockResolvedValueOnce({ ok: false, error: 'Rate limited' });
    render(
      <NotifyStakeholdersButton
        incidentId="i1"
        businessServices={[{ id: 'b', name: 'Checkout' }]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Notify stakeholders/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send update' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Rate limited');
    // The ids shown in the dialog are the ids sent, so a changed impact set is rejected, not mailed.
    expect(notifyStakeholders).toHaveBeenCalledWith('i1', {
      phase: 'investigating',
      message: 'Hello',
      businessServiceIds: ['b'],
    });
    fireEvent.change(within(dialog).getByLabelText('Message'), {
      target: { value: 'Hello again' },
    });
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('reseeds the message from the current services each time it opens', async () => {
    const { rerender } = render(
      <NotifyStakeholdersButton
        incidentId="i1"
        businessServices={[{ id: 'b', name: 'Checkout' }]}
      />
    );
    rerender(
      <NotifyStakeholdersButton incidentId="i1" businessServices={[{ id: 'c', name: 'Search' }]} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Notify stakeholders/ }));
    const message = (await screen.findByLabelText('Message')) as HTMLTextAreaElement;
    expect(message.value).toContain('Search');
    expect(message.value).not.toContain('Checkout');
  });
});

describe('BusinessServiceForm server errors', () => {
  it('maps inline fields and shows the banner for fields with no inline slot', () => {
    const result = mapServerErrors(
      { name: 'A business service with this name already exists.', ownerTeamId: 'Team not found' },
      'Check the highlighted fields.'
    );
    expect(result.mapped).toEqual({
      'bs-name': 'A business service with this name already exists.',
    });
    expect(result.banner).toBe('Owner team: Team not found');
  });

  it('falls back to the first message when nothing maps, and to the action error without fieldErrors', () => {
    expect(mapServerErrors({ followerUserIds: 'Unknown user' }, 'Check').banner).toBe(
      'Followers: Unknown user'
    );
    expect(mapServerErrors({ somethingNew: 'Odd' }, 'Check').mapped).toEqual({});
    expect(mapServerErrors(undefined, 'Something went wrong').banner).toBe('Something went wrong');
  });

  it('keeps the generic banner when every error is inline', () => {
    expect(mapServerErrors({ name: 'Taken' }, 'Check the highlighted fields.').banner).toBe(
      'Check the highlighted fields.'
    );
  });
});

describe('ImpactTimeline', () => {
  const entry = (startedAt: string): ImpactTimelineEntry =>
    ({
      incidentId: 'i1',
      incidentTitle: 'DB down',
      source: 'INCIDENT',
      urgency: 'HIGH',
      excluded: false,
      startedAt: new Date(startedAt),
      endedAt: new Date(new Date(startedAt).getTime() + 600_000),
    }) as unknown as ImpactTimelineEntry;
  const window = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-22T00:00:00Z') };

  it('keeps the selected day after a refresh hands back new entry objects; local time with UTC in the tooltip', async () => {
    const props = { window, showIncidents: true, now: window.to } as const;
    const { rerender } = render(
      <ImpactTimeline {...props} entries={[entry('2026-11-10T10:00:00Z')]} />
    );
    const day = screen.getAllByRole('button').find(b => b.tabIndex === 0)!;
    expect(day.getAttribute('title')).toContain('UTC');
    fireEvent.click(day);
    const detail = screen.getByTestId('impact-detail');
    // The viewer's zone is UTC in this test; the tooltip always carries the UTC reading.
    expect(within(detail).getByTitle('2026-11-10 10:00 UTC')).toBeInTheDocument();
    rerender(<ImpactTimeline {...props} entries={[entry('2026-11-10T10:00:00Z')]} />);
    await waitFor(() => expect(screen.getByTestId('impact-detail')).toBeInTheDocument());
  });
});
