import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OverrideForm from '@/components/OverrideForm';

vi.mock('@/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span aria-hidden="true">{name.slice(0, 1)}</span>,
}));

const suggestOverrideCover = vi.fn().mockResolvedValue(null);
vi.mock('@/app/(app)/schedules/cover-actions', () => ({
  suggestOverrideCover: (input: unknown) => suggestOverrideCover(input),
}));

const responders = [
  { id: 'alex', name: 'Alex Vance', email: 'alex@example.com', role: 'RESPONDER' },
  { id: 'sam', name: 'Sam Reed', email: 'sam@example.com', role: 'RESPONDER' },
];

describe('OverrideForm', () => {
  it('makes replacement and additive semantics explicit', () => {
    render(
      <OverrideForm
        scheduleId="schedule-1"
        users={responders}
        canCreateOverride
        createOverride={vi.fn()}
        scheduleTimeZone="Asia/Kathmandu"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
    expect(screen.getByRole('button', { name: /Replace someone/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: /Add extra coverage/ }));
    expect(screen.queryByText('Responder being replaced')).not.toBeInTheDocument();
    expect(screen.getByText(/regardless of your browser timezone/)).toBeInTheDocument();
  });

  it('submits additive coverage without a replacement user', async () => {
    const createOverride = vi.fn().mockResolvedValue(undefined);
    render(
      <OverrideForm
        scheduleId="schedule-1"
        users={responders}
        canCreateOverride
        createOverride={createOverride}
        scheduleTimeZone="Asia/Kathmandu"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
    fireEvent.click(screen.getByRole('button', { name: /Add extra coverage/ }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Select responder' }));
    fireEvent.click(screen.getByText('Alex Vance'));
    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-08-29T15:45' },
    });
    fireEvent.change(screen.getByLabelText('Ends'), {
      target: { value: '2026-08-29T16:45' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add coverage' }));

    await waitFor(() => expect(createOverride).toHaveBeenCalledOnce());
    const [scheduleId, formData] = createOverride.mock.calls[0] as [string, FormData];
    expect(scheduleId).toBe('schedule-1');
    expect(formData.get('userId')).toBe('alex');
    expect(formData.get('replacesUserId')).toBe('');
    expect(formData.get('start')).toBe('2026-08-29T15:45');
  });

  it('offers ranked cover for the window and picks one as the responder', async () => {
    suggestOverrideCover.mockResolvedValueOnce({
      gap: true,
      windowDays: 28,
      candidates: [
        { userId: 'sam', name: 'Sam Reed', daytime: true, pages: 2, nightPages: 0 },
        { userId: 'alex', name: 'Alex Vance', daytime: false, pages: null, nightPages: null },
      ],
    });
    render(
      <OverrideForm
        scheduleId="schedule-1"
        users={responders}
        canCreateOverride
        createOverride={vi.fn()}
        scheduleTimeZone="UTC"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-08-29T10:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-08-29T12:00' } });

    const sam = await screen.findByRole('button', { name: /Sam Reed.*2 pages, 0 at night/ });
    expect(suggestOverrideCover).toHaveBeenLastCalledWith({
      scheduleId: 'schedule-1',
      start: '2026-08-29T10:00:00.000Z',
      end: '2026-08-29T12:00:00.000Z',
      replacesUserId: null,
    });
    expect(screen.getByText(/nobody on call/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alex Vance/ })).not.toHaveTextContent('pages');
    fireEvent.click(sam);
    expect(sam).toHaveAttribute('aria-pressed', 'true');
  });
});
