'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { SlackLogo, JiraLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { MessageSquare } from 'lucide-react';

const INTEGRATION_LINKS = [
  { id: 'slack', label: 'Slack', href: '/settings/integrations/slack', icon: SlackLogo },
  {
    id: 'microsoft-teams',
    label: 'Microsoft Teams',
    href: '/settings/integrations/microsoft-teams',
    icon: MicrosoftTeamsLogo,
  },
  {
    id: 'jira',
    label: 'Jira Issue Tracking',
    href: '/settings/integrations/jira',
    icon: JiraLogo,
  },
  {
    id: 'chatops',
    label: 'ChatOps War-Rooms',
    href: '/settings/integrations/chatops',
    icon: MessageSquare,
  },
];

export default function IntegrationsSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {INTEGRATION_LINKS.map(item => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all select-none',
              isActive
                ? 'bg-primary/10 text-primary border border-primary/30 font-semibold shadow-2xs'
                : 'border border-border/60 bg-card hover:bg-accent/60 text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
