'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Bot, Layers, ShieldCheck, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
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

export default function IntelligenceSubNav() {
  const pathname = usePathname() ?? '';
  const activeId = activeGroupFor(pathname);
  return (
    <nav
      aria-label="Intelligence sections"
      className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
    >
      {INTELLIGENCE_SECTIONS.map(item => {
        const active = item.id === activeId;
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 shrink-0 select-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none',
              active
                ? 'border border-primary/30 bg-primary/10 font-semibold text-primary shadow-2xs'
                : 'border border-border/60 bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
