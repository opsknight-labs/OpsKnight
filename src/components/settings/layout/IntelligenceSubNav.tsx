'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Bot, GitBranch, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export const INTELLIGENCE_SECTIONS = [
  { id: 'overview', label: 'Overview', href: '/settings/intelligence', icon: Activity },
  {
    id: 'services',
    label: 'Per-service policies',
    href: '/settings/intelligence/services',
    icon: Layers,
  },
  {
    id: 'response',
    label: 'Dependencies & changes',
    href: '/settings/intelligence/response',
    icon: GitBranch,
  },
  { id: 'insights', label: 'Insights', href: '/settings/intelligence/insights', icon: BarChart3 },
  { id: 'quality', label: 'Quality', href: '/settings/intelligence/quality', icon: BarChart3 },
  { id: 'ai', label: 'Assistant & AI', href: '/settings/intelligence/ai', icon: Bot },
] as const;

/** Overview matches only itself; every other section also owns its nested paths. */
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === '/settings/intelligence') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function IntelligenceSubNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label="Intelligence sections"
      className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
    >
      {INTELLIGENCE_SECTIONS.map(item => {
        const active = isSectionActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 select-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
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
