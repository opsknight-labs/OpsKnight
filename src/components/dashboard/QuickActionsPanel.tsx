'use client';

import Link from 'next/link';
import SidebarWidget, { WIDGET_ICON_BG } from '@/components/dashboard/SidebarWidget';
import { Siren, BarChart2, Settings, Zap, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';

interface QuickActionsPanelProps {
  greeting: string;
  userName: string;
}

export default function QuickActionsPanel({ greeting, userName }: QuickActionsPanelProps) {
  const { openCreateIncident } = useCreateIncidentModal();
  const actions = [
    {
      href: '#',
      label: 'Trigger Incident',
      icon: <Siren className="w-4 h-4" />,
      variant: 'primary' as const,
      isModal: true,
    },
    {
      href: '/analytics',
      label: 'View Analytics',
      icon: <BarChart2 className="w-4 h-4" />,
      variant: 'secondary' as const,
      isModal: false,
    },
    {
      href: '/services',
      label: 'Manage Services',
      icon: <Settings className="w-4 h-4" />,
      variant: 'secondary' as const,
      isModal: false,
    },
  ];

  return (
    <SidebarWidget
      title={`${greeting}, ${userName}`}
      iconBg={WIDGET_ICON_BG.slate}
      icon={<Zap className="w-4 h-4" />}
      subtitle="Quick actions"
    >
      <div className="space-y-2">
        {actions.map((action, idx) => {
          const isPrimary = action.variant === 'primary';
          const classes = cn(
            'group flex items-center gap-3 p-2.5 rounded-lg border transition-all duration-150 w-full shadow-2xs cursor-pointer',
            isPrimary
              ? 'bg-[#18181b] hover:bg-[#27272a] text-white border-zinc-700/80 hover:border-zinc-500/80 shadow-xs'
              : 'bg-card dark:bg-[#121216] border-border dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-muted/40 dark:hover:bg-zinc-800/40 text-foreground'
          );
          const content = (
            <>
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150',
                  isPrimary
                    ? 'bg-white/10 text-white group-hover:bg-white/20 group-hover:scale-105'
                    : 'bg-muted dark:bg-zinc-800/80 text-muted-foreground group-hover:text-foreground group-hover:bg-muted/90'
                )}
              >
                {action.icon}
              </div>
              <span
                className={cn(
                  'flex-1 text-xs font-semibold text-left',
                  isPrimary ? 'text-white' : 'text-foreground'
                )}
              >
                {action.label}
              </span>
              <ChevronRight
                className={cn(
                  'w-3.5 h-3.5 shrink-0 transition-all duration-150 group-hover:translate-x-0.5',
                  isPrimary
                    ? 'text-zinc-400 group-hover:text-white'
                    : 'text-muted-foreground/50 group-hover:text-foreground'
                )}
              />
            </>
          );

          if (action.isModal) {
            return (
              <button key={idx} onClick={() => openCreateIncident()} className={classes}>
                {content}
              </button>
            );
          }

          return (
            <Link key={idx} href={action.href} className={classes}>
              {content}
            </Link>
          );
        })}
      </div>
    </SidebarWidget>
  );
}
