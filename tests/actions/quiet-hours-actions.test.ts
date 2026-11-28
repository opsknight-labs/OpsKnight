import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate } },
}));

import { updateQuietHoursPreferences } from '@/app/(app)/settings/quiet-hours-actions';

function form(start: string | null, end: string | null) {
  const data = new FormData();
  data.set('quietHoursEnabled', 'on');
  if (start !== null) data.set('quietHoursStart', start);
  if (end !== null) data.set('quietHoursEnd', end);
  return data;
}

describe('updateQuietHoursPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: 'a@example.com' } });
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1' });
  });

  it.each([
    ['a cleared start time', '', '07:00'],
    ['a cleared end time', '22:00', ''],
    ['missing fields', null, null],
  ])('rejects %s instead of saving the 18:00/08:00 default', async (_name, start, end) => {
    const result = await updateQuietHoursPreferences({}, form(start, end));

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/valid times/);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('saves the times the user entered', async () => {
    const result = await updateQuietHoursPreferences({}, form('22:30', '06:15'));

    expect(result).toEqual({ success: true });
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quietHoursStartMinutes: 22 * 60 + 30,
          quietHoursEndMinutes: 6 * 60 + 15,
        }),
      })
    );
  });
});
