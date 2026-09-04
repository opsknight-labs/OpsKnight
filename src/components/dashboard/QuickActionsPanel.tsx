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
          const classes = cn(
            'group flex items-center gap-3 p-2.5 rounded-lg border transition-colors w-full',
            action.variant === 'primary'
              ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
              : 'bg-white border-slate-100 text-slate-700 hover:border-slate-200 hover:bg-slate-50/50'
          );
          const content = (
            <>
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  action.variant === 'primary' ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
                )}
              >
                {action.icon}
              </div>
              <span className="flex-1 text-xs font-semibold text-left">{action.label}</span>
              <ChevronRight
                className={cn(
                  'w-3.5 h-3.5 shrink-0 transition-colors',
                  action.variant === 'primary'
                    ? 'text-white/50 group-hover:text-white/80'
                    : 'text-slate-300 group-hover:text-slate-500'
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
