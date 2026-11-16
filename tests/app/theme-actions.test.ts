import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: { user: { update } } }));
vi.mock('@/lib/request-actor-context', () => ({
  getRequestActorContext: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

import { updateThemePreference } from '@/app/theme-actions';

describe('updateThemePreference', () => {
  beforeEach(() => update.mockReset());

  it('saves a valid choice to the signed-in user', async () => {
    await expect(updateThemePreference({ choice: 'dark' })).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { themePreference: 'DARK' },
    });
  });

  it.each([
    'dark',
    { choice: 'sepia' },
    { choice: 'dark', extra: true },
    null,
  ])('rejects malformed input %j without writing', async input => {
    await expect(updateThemePreference(input)).resolves.toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});
