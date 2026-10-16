'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, KeyRound, Network, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FLEET_SECTIONS, isFleetSectionActive, type FleetSection } from './fleet-routes';

const ICONS: Record<FleetSection, typeof Bot> = {
  agents: Bot,
  pools: Network,
  secrets: KeyRound,
  security: ShieldCheck,
};

export function FleetSubNav({ canManageSecrets }: { canManageSecrets: boolean }) {
  const pathname = usePathname() ?? '';
  const sections = FLEET_SECTIONS.filter(section => section.key !== 'secrets' || canManageSecrets);

  return (
    <nav aria-label="Infrastructure sections" className="no-scrollbar overflow-x-auto border-b">
      <div className="flex min-w-max items-center gap-1">
        {sections.map(section => {
          const active = isFleetSectionActive(pathname, section.key);
          const Icon = ICONS[section.key];
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative -mb-px flex items-center gap-2 rounded-t-md border-b-2 px-3 pb-2.5 pt-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
