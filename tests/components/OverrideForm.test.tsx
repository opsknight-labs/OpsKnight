import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OverrideForm from '@/components/OverrideForm';

const showToast = vi.fn();
vi.mock('@/hooks/use-product-notification', () => ({
  useToast: () => ({ showToast }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span aria-hidden="true">{name.slice(0, 1)}</span>,
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
});
