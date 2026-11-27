import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScheduleEditForm from '@/components/ScheduleEditForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/TimeZoneSelect', () => ({
  default: ({ onChange }: { onChange?: (value: string) => void }) => (
    <button type="button" onClick={() => onChange?.('America/New_York')}>
      pick New York
    </button>
  ),
}));

describe('ScheduleEditForm time zone change', () => {
  const updateSchedule = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateSchedule.mockResolvedValue(undefined);
  });

  function renderForm() {
    render(
      <ScheduleEditForm
        scheduleId="sched-1"
        currentName="Primary"
        currentTimeZone="UTC"
        currentRevision={7}
        updateSchedule={updateSchedule}
        canManageSchedules
      />
    );
  }

  it('asks for confirmation before saving a new time zone and saves only after it', async () => {
    renderForm();
    fireEvent.click(screen.getByText('pick New York'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/America\/New_York instead of UTC/)).toBeInTheDocument();
    expect(updateSchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /change time zone/i }));

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledTimes(1));
    const formData = updateSchedule.mock.calls[0][1] as FormData;
    expect(formData.get('timeZone')).toBe('America/New_York');
  });

  it('does not save when the confirmation is dismissed', async () => {
    renderForm();
    fireEvent.click(screen.getByText('pick New York'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep current time zone/i }));

    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it('saves a rename without asking', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Primary 2' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Change schedule time zone/)).not.toBeInTheDocument();
    // The revision the page was rendered from rides along so a stale save is refused.
    expect((updateSchedule.mock.calls[0][1] as FormData).get('revision')).toBe('7');
  });
});
