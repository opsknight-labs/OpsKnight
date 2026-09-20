import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_NAV_ITEMS, SETTINGS_NAV_SECTIONS } from '@/components/settings/navConfig';
import ServiceObjectivesPage from '@/app/(app)/settings/service-objectives/page';

const mockRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    serviceObjective: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('Service Objectives Settings Page (deferred release)', () => {
  it('excludes service-objectives from SETTINGS_NAV_ITEMS', () => {
    const item = SETTINGS_NAV_ITEMS.find(
      nav => nav.id === 'service-objectives' || nav.href === '/settings/service-objectives'
    );
    expect(item).toBeUndefined();
  });

  it('excludes service-objectives from SETTINGS_NAV_SECTIONS items', () => {
    const allSectionItems = SETTINGS_NAV_SECTIONS.flatMap(section => section.items);
    const item = allSectionItems.find(
      nav => nav.id === 'service-objectives' || nav.href === '/settings/service-objectives'
    );
    expect(item).toBeUndefined();
  });

  it('redirects direct navigation to /settings', async () => {
    await expect(ServiceObjectivesPage()).rejects.toThrow('REDIRECT:/settings');
    expect(mockRedirect).toHaveBeenCalledWith('/settings');
  });
});
