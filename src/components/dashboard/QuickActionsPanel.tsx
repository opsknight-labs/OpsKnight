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
            'group flex items-center gap-3 p-2.5 rounded-lg border transition-all w-full shadow-xs',
            action.variant === 'primary'
              ? 'bg-[#09090b] text-white border-zinc-800/80 hover:bg-[#18181b] hover:border-zinc-700/80'
              : 'bg-white border-border text-slate-700 hover:border-slate-300 hover:bg-slate-50/50'
          );
          const content = (
            <>
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                  action.variant === 'primary'
                    ? 'bg-white/10 text-white'
                    : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200/70'
                )}
              >
                {action.icon}
              </div>
              <span className="flex-1 text-xs font-semibold text-left">{action.label}</span>
              <ChevronRight
                className={cn(
                  'w-3.5 h-3.5 shrink-0 transition-colors',
                  action.variant === 'primary'
                    ? 'text-zinc-500 group-hover:text-zinc-300'
                    : 'text-slate-400 group-hover:text-slate-600'
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
