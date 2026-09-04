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
      iconBg={WIDGET_ICON_BG.orange}
      icon={<Zap className="w-4 h-4" />}
      subtitle="Quick actions"
    >
      <div className="space-y-1.5">
        {actions.map((action, idx) => {
          const classes = cn(
            'group flex items-center gap-2.5 p-2 rounded-lg border transition-all w-full',
            action.variant === 'primary'
              ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-2xs'
              : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 shadow-2xs'
          );
          const content = (
            <>
              <div
                className={cn(
                  'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
                  action.variant === 'primary'
                    ? 'bg-white/20 text-white'
                    : 'bg-white border border-slate-200/80 text-slate-600'
                )}
              >
                {action.icon}
              </div>
              <span className="flex-1 text-xs font-semibold text-left">{action.label}</span>
              <ChevronRight
                className={cn(
                  'w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-0.5',
                  action.variant === 'primary'
                    ? 'text-white/70 group-hover:text-white'
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
