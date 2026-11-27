import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OverrideStatus } from '@/lib/schedules/detail-view-model';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: { success: mocks.success, error: mocks.error } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/UserAvatar', () => ({ default: () => null }));

import OverrideList from '@/components/OverrideList';

const override = {
  id: 'ovr-1',
  start: new Date('2026-12-01T10:00:00Z'),
  end: new Date('2026-12-02T10:00:00Z'),
  userId: 'user-1',
  replacesUserId: null,
  user: { name: 'Ada' },
  replacesUser: null,
};

function renderList(status: OverrideStatus) {
  const deleteOverride = vi.fn().mockResolvedValue(undefined);
  render(
    <OverrideList
      overrides={[override]}
      scheduleId="sched-1"
      canDeleteOverride
      deleteOverride={deleteOverride}
      timeZone="UTC"
      status={status}
      emptyMessage=""
    />
  );
  return deleteOverride;
}

describe('OverrideList confirmation toast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says an override that was running was ended', async () => {
    const deleteOverride = renderList('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: /End override for Ada/ }));
    fireEvent.click(screen.getByRole('button', { name: 'End override' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Override ended successfully.'));
    expect(deleteOverride).toHaveBeenCalledWith('sched-1', 'ovr-1');
  });

  it('says an upcoming override was deleted', async () => {
    renderList('UPCOMING');
    fireEvent.click(screen.getByRole('button', { name: /Delete override for Ada/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete override' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Override deleted successfully.'));
  });
});
