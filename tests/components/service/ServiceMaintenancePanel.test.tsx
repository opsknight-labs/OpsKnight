import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  createMaintenanceWindowAction: vi.fn(async () => ({ ok: true as const })),
  updateMaintenanceWindowAction: vi.fn(async () => ({ ok: true as const })),
  endMaintenanceWindowAction: vi.fn(async () => ({ ok: true as const })),
  deleteMaintenanceWindowAction: vi.fn(async () => ({ ok: true as const })),
  createMaintenanceScheduleAction: vi.fn(async () => ({ ok: true as const })),
  updateMaintenanceScheduleAction: vi.fn(async () => ({ ok: true as const })),
  deleteMaintenanceScheduleAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock('@/app/(app)/services/[id]/maintenance-actions', () => actions);
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import ServiceMaintenancePanel, {
  type MaintenanceScheduleView,
  type MaintenanceWindowView,
} from '@/components/service/ServiceMaintenancePanel';

const services = [
  { id: 'svc-a', name: 'Checkout API' },
  { id: 'svc-b', name: 'Payments' },
  { id: 'svc-c', name: 'Search' },
];

const schedule: MaintenanceScheduleView = {
  id: 'sched-1',
  title: 'Weekly patching',
  summary: 'Every Sun, Wed 02:30–04:00 Asia/Kolkata',
  paused: false,
  nextLabel: 'Sun 02:30',
  serviceNames: ['Checkout API', 'Payments'],
  hiddenServiceCount: 0,
  description: 'Kernel updates',
  serviceIds: ['svc-a', 'svc-b'],
  frequency: 'WEEKLY',
  interval: 2,
  byWeekday: [0, 3],
  dayOfMonth: null,
  timeZone: 'Asia/Kolkata',
  startTime: '02:30',
  durationMinutes: 90,
  startsOn: '2030-01-06',
  endsOn: '2030-12-31',
  endBehavior: 'RESOLVE_HELD',
  publishToStatusPage: true,
};

const activeWindow: MaintenanceWindowView = {
  id: 'win-1',
  title: 'Postgres upgrade',
  description: null,
  phase: 'ACTIVE',
  startsAt: '2030-01-01T00:00:00.000Z',
  endsAt: '2030-01-01T02:00:00.000Z',
  startsLabel: 'start',
  endsLabel: 'end',
  endBehavior: 'RESUME_FIRING',
  publishToStatusPage: false,
  serviceNames: ['Checkout API'],
  hiddenServiceCount: 0,
  heldCount: 2,
  recurring: false,
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ServiceMaintenancePanel>> = {}
) {
  return render(
    <ServiceMaintenancePanel
      serviceId="svc-a"
      canManage
      windows={[activeWindow]}
      schedules={[schedule]}
      services={services}
      userTimeZone="UTC"
      {...overrides}
    />
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockClear();
});
afterEach(cleanup);

describe('ServiceMaintenancePanel', () => {
  it('prefills the edit dialog from the schedule and saves every field', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Weekly patching' }));

    expect(await screen.findByText('Edit recurring maintenance')).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Weekly patching');
    expect((screen.getByLabelText('Description (optional)') as HTMLTextAreaElement).value).toBe(
      'Kernel updates'
    );
    const repeat = screen.getByLabelText('Repeat') as HTMLSelectElement;
    expect(repeat.value).toBe('WEEKLY');
    expect([...repeat.options].map(o => o.value)).not.toContain('NONE');
    expect((screen.getByLabelText('Every') as HTMLInputElement).value).toBe('2');
    const pressed = screen
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent);
    expect(pressed).toEqual(['Sun', 'Wed']);
    expect((screen.getByLabelText('Starting') as HTMLInputElement).value).toBe('2030-01-06');
    expect((screen.getByLabelText('At') as HTMLInputElement).value).toBe('02:30');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2030-12-31');
    expect((screen.getByLabelText('Duration') as HTMLSelectElement).value).toBe('90');
    expect((document.querySelector('input[name="timeZone"]') as HTMLInputElement).value).toBe(
      'Asia/Kolkata'
    );
    expect(
      (document.querySelector('input[value="RESOLVE_HELD"]') as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByText('Services (2)')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Biweekly patching' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    await waitFor(() => expect(actions.updateMaintenanceScheduleAction).toHaveBeenCalledTimes(1));
    expect(actions.createMaintenanceScheduleAction).not.toHaveBeenCalled();
    expect(actions.updateMaintenanceScheduleAction).toHaveBeenCalledWith('svc-a', 'sched-1', {
      title: 'Biweekly patching',
      description: 'Kernel updates',
      serviceIds: ['svc-a', 'svc-b'],
      endBehavior: 'RESOLVE_HELD',
      publishToStatusPage: true,
      frequency: 'WEEKLY',
      interval: 2,
      byWeekday: [0, 3],
      dayOfMonth: null,
      timeZone: 'Asia/Kolkata',
      startTime: '02:30',
      durationMinutes: 90,
      startsOn: '2030-01-06',
      endsOn: '2030-12-31',
    });
  });

  it('asks before ending a window early or deleting a schedule', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'End now' }));
    expect(await screen.findByText('End maintenance now?')).toBeTruthy();
    expect(actions.endMaintenanceWindowAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByText('End maintenance now?')).toBeNull());
    expect(actions.endMaintenanceWindowAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'End now' }));
    await screen.findByText('End maintenance now?');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'End now' }).at(-1)!);
    });
    await waitFor(() =>
      expect(actions.endMaintenanceWindowAction).toHaveBeenCalledWith('svc-a', 'win-1')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this recurring schedule?')).toBeTruthy();
    expect(actions.deleteMaintenanceScheduleAction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    });
    await waitFor(() =>
      expect(actions.deleteMaintenanceScheduleAction).toHaveBeenCalledWith('svc-a', 'sched-1')
    );
  });

  it('reads a one-off start time in the profile time zone, not the browser zone', async () => {
    renderPanel({ userTimeZone: 'America/Los_Angeles' });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule maintenance' }));
    await screen.findByText('Schedule maintenance', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Reboot' } });
    fireEvent.click(screen.getByLabelText('Start now'));
    expect(screen.getByText('Time in America/Los_Angeles')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '2030-01-15T02:00' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    });

    await waitFor(() => expect(actions.createMaintenanceWindowAction).toHaveBeenCalledTimes(1));
    const [, input] = actions.createMaintenanceWindowAction.mock.calls[0] as unknown as [
      string,
      { startsAt: Date; endsAt: Date },
    ];
    // 02:00 PST is 10:00 UTC, whatever zone the browser (or test runner) is in.
    expect(input.startsAt.toISOString()).toBe('2030-01-15T10:00:00.000Z');
    expect(input.endsAt.toISOString()).toBe('2030-01-15T11:00:00.000Z');
  });

  it('names only visible services and counts the hidden ones', () => {
    renderPanel({
      windows: [{ ...activeWindow, hiddenServiceCount: 2 }],
      schedules: [{ ...schedule, serviceNames: ['Checkout API'], hiddenServiceCount: 1 }],
    });
    expect(screen.getByText(/Checkout API, \+2 other services ·/)).toBeTruthy();
    expect(screen.getByText(/· Checkout API, \+1 other service$/)).toBeTruthy();
  });

  it('filters a long service picker by name', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `svc-${i}`, name: `Service ${i}` }));
    renderPanel({ services: [{ id: 'svc-a', name: 'Checkout API' }, ...many] });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule maintenance' }));
    fireEvent.change(await screen.findByLabelText('Filter services'), {
      target: { value: 'service 1' },
    });
    const names = screen.getAllByRole('checkbox').map(c => c.parentElement?.textContent);
    expect(names).toEqual(['Service 1', 'Service 10', 'Service 11']);
  });
});
