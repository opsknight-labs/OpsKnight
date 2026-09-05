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
              ? 'bg-card dark:bg-[#121216] border-rose-500/30 dark:border-rose-500/30 border-l-[3px] border-l-rose-500 hover:border-rose-500/50 hover:bg-rose-500/[0.03] dark:hover:bg-rose-500/[0.06] text-foreground'
              : 'bg-card dark:bg-[#121216] border-border dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-muted/40 dark:hover:bg-zinc-800/40 text-foreground'
          );
          const content = (
            <>
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150',
                  isPrimary
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 group-hover:bg-rose-500/20 group-hover:scale-105'
                    : 'bg-muted dark:bg-zinc-800/80 text-muted-foreground group-hover:text-foreground group-hover:bg-muted/90'
                )}
              >
                {action.icon}
              </div>
              <span className="flex-1 text-xs font-semibold text-left text-foreground">
                {action.label}
              </span>
              <ChevronRight
                className={cn(
                  'w-3.5 h-3.5 shrink-0 transition-all duration-150 group-hover:translate-x-0.5',
                  isPrimary
                    ? 'text-muted-foreground/60 group-hover:text-rose-600 dark:group-hover:text-rose-400'
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
