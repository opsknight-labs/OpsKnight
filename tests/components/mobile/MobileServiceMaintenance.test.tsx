import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileServiceMaintenance, {
  type MobileMaintenanceWindow,
} from '@/components/mobile/MobileServiceMaintenance';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const createAction = vi.fn();
const endAction = vi.fn();
vi.mock('@/app/(app)/services/[id]/maintenance-actions', () => ({
  createMaintenanceWindowAction: (...args: unknown[]) => createAction(...args),
  endMaintenanceWindowAction: (...args: unknown[]) => endAction(...args),
}));

const active: MobileMaintenanceWindow = {
  id: 'mw-1',
  title: 'DB failover',
  phase: 'ACTIVE',
  startsAt: '2026-11-16T10:00:00.000Z',
  endsAt: '2026-11-16T12:00:00.000Z',
  heldCount: 3,
};
const upcoming: MobileMaintenanceWindow = {
  id: 'mw-2',
  title: 'Kernel patch',
  phase: 'UPCOMING',
  startsAt: '2026-11-17T10:00:00.000Z',
  endsAt: '2026-11-17T11:00:00.000Z',
  heldCount: 0,
};

describe('MobileServiceMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the active window with held count and ends it', async () => {
    endAction.mockResolvedValue({ ok: true });
    render(<MobileServiceMaintenance serviceId="svc-1" canManage windows={[upcoming, active]} />);

    expect(screen.getByRole('status')).toHaveTextContent(/In maintenance until/);
    expect(screen.getByText('3 alerts held · nobody is paged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start maintenance/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'End maintenance window DB failover now' }));
    // The first tap only asks; nothing ends until it is confirmed.
    expect(endAction).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm ending maintenance window DB failover' })
    );
    await waitFor(() => expect(endAction).toHaveBeenCalledWith('svc-1', 'mw-1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows the next upcoming window and hides manage actions from viewers', () => {
    render(<MobileServiceMaintenance serviceId="svc-1" canManage={false} windows={[upcoming]} />);

    expect(screen.getByText(/Maintenance starts/)).toBeInTheDocument();
    expect(screen.getAllByText('Kernel patch').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Start maintenance|End/ })).toBeNull();
  });

  it('starts a window now for the picked duration', async () => {
    createAction.mockResolvedValue({ ok: true });
    render(<MobileServiceMaintenance serviceId="svc-1" canManage windows={[]} />);

    expect(screen.getByText('No maintenance scheduled.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start maintenance/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Swap disk' } });
    fireEvent.click(screen.getByRole('button', { name: '2h' }));
    expect(screen.getByRole('button', { name: '2h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    const [pathId, input] = createAction.mock.calls[0];
    expect(pathId).toBe('svc-1');
    expect(input.title).toBe('Swap disk');
    expect(input.serviceIds).toEqual(['svc-1']);
    // The server clock sets the start; the phone only sends how long.
    expect(input.startNowForMinutes).toBe(120);
    expect(input.startsAt).toBeUndefined();
  });

  it('shows the action error inline', async () => {
    createAction.mockResolvedValue({ ok: false, error: 'Unauthorized.' });
    render(<MobileServiceMaintenance serviceId="svc-1" canManage windows={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /Start maintenance/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
