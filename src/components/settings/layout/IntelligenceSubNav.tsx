'use client';

import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Bot, Layers, ShieldCheck, type LucideIcon } from 'lucide-react';
import { LinkTabs } from '@/components/settings/layout/LinkTabs';
import {
  INTELLIGENCE_SETTINGS_GROUPS,
  INTELLIGENCE_SETTINGS_ROOT,
  LEGACY_INTELLIGENCE_ROUTES,
  type IntelligenceSettingsGroupId,
} from '@/lib/intelligence/settings/routes';

const ICONS: Record<IntelligenceSettingsGroupId, LucideIcon> = {
  engine: Activity,
  noise: ShieldCheck,
  services: Layers,
  assistant: Bot,
  evaluation: BarChart3,
};

/** The five groups of Settings → Intelligence, in navigation order. */
export const INTELLIGENCE_SECTIONS = INTELLIGENCE_SETTINGS_GROUPS.map(group => ({
  id: group.id,
  label: group.label,
  href: group.href,
  icon: ICONS[group.id],
}));

/** Engine (the root) matches only itself; every other group also owns its nested paths. */
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === INTELLIGENCE_SETTINGS_ROOT) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The group a path belongs to. An earlier route (shown for a moment while its redirect resolves)
 * belongs to the group it redirects to, not to the group whose path happens to prefix it.
 */
export function activeGroupFor(pathname: string): IntelligenceSettingsGroupId | null {
  const legacy = LEGACY_INTELLIGENCE_ROUTES.find(
    route => pathname === route.from || pathname.startsWith(`${route.from}/`)
  );
  if (legacy) return legacy.group;
  return INTELLIGENCE_SECTIONS.find(item => isSectionActive(pathname, item.href))?.id ?? null;
}

/** The five group pages as one tab row (a "Section" picker on phones), under the page header. */
export default function IntelligenceSubNav() {
  const pathname = usePathname() ?? '';
  const activeId = activeGroupFor(pathname);
  return (
    <LinkTabs
      label="Intelligence sections"
      activeHref={INTELLIGENCE_SECTIONS.find(item => item.id === activeId)?.href ?? null}
      items={INTELLIGENCE_SECTIONS.map(item => {
        const Icon = item.icon;
        return { href: item.href, label: item.label, icon: <Icon /> };
      })}
    />
  );
}
