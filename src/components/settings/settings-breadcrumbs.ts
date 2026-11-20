import type { BreadcrumbItem } from '@/components/patterns/PageHeader';
import {
  SETTINGS_NAV_SECTIONS,
  type SettingsNavItem,
  type SettingsNavSection,
} from '@/components/settings/navConfig';

/** Where a section crumb leads: the integrations hub, or the section on the settings home. */
export function settingsSectionHref(sectionId: string): string {
  return sectionId === 'integrations' ? '/settings/integrations' : `/settings#${sectionId}`;
}

/** Longest-prefix match so /settings/notifications/operations wins over /settings/notifications. */
export function findSettingsNavMatch(
  pathname: string
): { item: SettingsNavItem; section: SettingsNavSection } | null {
  let best: { item: SettingsNavItem; section: SettingsNavSection } | null = null;
  for (const section of SETTINGS_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.href === '/settings') continue;
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.item.href.length)) {
        best = { item, section };
      }
    }
  }
  return best;
}

/** Settings › Section › Page [› trail], derived from the settings navigation. */
export function buildSettingsBreadcrumbs(
  pathname: string,
  { currentLabel, trail }: { currentLabel?: string; trail?: BreadcrumbItem[] } = {}
): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [{ label: 'Settings', href: '/settings' }];
  const match = findSettingsNavMatch(pathname);
  if (!match) {
    if (trail?.length) crumbs.push(...trail);
    else crumbs.push({ label: currentLabel ?? 'Settings' });
    return crumbs;
  }
  const { item, section } = match;
  crumbs.push({ label: section.label, href: settingsSectionHref(section.id) });
  const isDeepChild = pathname !== item.href;
  if (isDeepChild || trail?.length) {
    crumbs.push({ label: item.label, href: item.href });
    if (trail?.length) crumbs.push(...trail);
    else crumbs.push({ label: currentLabel ?? 'Details' });
  } else {
    crumbs.push({ label: item.label });
  }
  return crumbs;
}
