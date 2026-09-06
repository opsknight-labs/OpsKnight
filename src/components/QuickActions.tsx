'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/shadcn/dropdown-menu';
import { Button } from '@/components/ui/shadcn/button';
import {
  Plus,
  Zap,
  FileText,
  Server,
  Users,
  Calendar,
  Shield,
  ArrowRight,
  Sparkles,
  ChevronDown,
  LayoutTemplate,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

type QuickAction = {
  label: string;
  href: string;
  icon: React.ReactElement<{ className?: string }>;
  description?: string;
  colorClass: string;
  badge?: string;
  shortcut?: string;
};

type QuickActionsProps = {
  canCreate?: boolean;
};

export default function QuickActions({ canCreate = true }: QuickActionsProps) {
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(prev => !prev);
    window.addEventListener('openQuickCreate', handleOpen);
    return () => window.removeEventListener('openQuickCreate', handleOpen);
  }, []);

  if (!canCreate) {
    return null;
  }

  const quickActions: QuickAction[] = [
    {
      label: 'New Incident',
      href: '/incidents/create',
      description: 'Trigger a new incident response',
      icon: <Zap className="h-4 w-4" />,
      colorClass: 'bg-red-50 text-red-600 border-red-100 group-hover:bg-red-100',
      shortcut: 'I',
    },
    {
      label: 'New Template',
      href: '/incidents/templates/create',
      description: 'Create incident template',
      icon: <LayoutTemplate className="h-4 w-4" />,
      colorClass: 'bg-slate-50 text-slate-600 border-slate-100 group-hover:bg-slate-100',
    },
    {
      label: 'New Postmortem',
      href: '/postmortems/create',
      description: 'Create retrospective report',
      icon: <FileText className="h-4 w-4" />,
      colorClass: 'bg-amber-50 text-amber-600 border-amber-100 group-hover:bg-amber-100',
    },
    {
      label: 'New Service',
      href: '/services',
      description: 'Register a new microservice',
      icon: <Server className="h-4 w-4" />,
      colorClass: 'bg-blue-50 text-blue-600 border-blue-100 group-hover:bg-blue-100',
      shortcut: 'S',
    },
    {
      label: 'New Team',
      href: '/teams',
      description: 'Create a response team',
      icon: <Users className="h-4 w-4" />,
      colorClass: 'bg-indigo-50 text-indigo-600 border-indigo-100 group-hover:bg-indigo-100',
    },
    {
      label: 'New Schedule',
      href: '/schedules',
      description: 'Set up on-call rotation',
      icon: <Calendar className="h-4 w-4" />,
      colorClass: 'bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:bg-emerald-100',
    },
    {
      label: 'New Policy',
      href: '/policies',
      description: 'Define escalation rules',
      icon: <Shield className="h-4 w-4" />,
      colorClass: 'bg-purple-50 text-purple-600 border-purple-100 group-hover:bg-purple-100',
      badge: 'Admin',
    },
  ];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="default"
          className="h-8 sm:h-9 px-2.5 sm:px-3 gap-1.5 font-semibold text-xs sm:text-[13px] rounded-lg shadow-xs transition-all duration-200 active:scale-95 bg-[#18181b] hover:bg-[#27272a] text-white border border-zinc-700/80 hover:border-zinc-500/80 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 select-none cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 stroke-[2.5]" />
          <span className="hidden sm:inline tracking-tight">Create</span>
          <ChevronDown className="h-3 w-3 opacity-75 group-data-[state=open]:rotate-180 transition-transform duration-200" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 p-1 overflow-hidden border border-border shadow-xl bg-white/95 dark:bg-[#121216]/95 backdrop-blur-xl z-[1050] rounded-xl"
      >
        {/* Comfortable Header */}
        <div className="relative p-3 bg-gradient-to-br from-[#18181b] via-[#121216] to-[#09090b] text-white overflow-hidden rounded-lg mb-1 border-b border-zinc-800/80">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1),transparent_50%)]" />

          <div className="relative z-10 flex items-center gap-2.5">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 border border-zinc-700/60 shadow-xs backdrop-blur-md shrink-0">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <p className="text-sm font-semibold truncate leading-tight text-white">Create New</p>
              <p className="text-xs text-zinc-400 font-normal truncate">Select resource type</p>
            </div>
          </div>
        </div>

        <div className="p-0.5 space-y-0.5">
          {quickActions.map((action, index) => (
            <React.Fragment key={action.href}>
              {index === 2 && <DropdownMenuSeparator className="my-1 bg-border/60" />}
              <DropdownMenuItem
                onClick={() => {
                  if (action.label === 'New Incident') {
                    openCreateIncident();
                  } else {
                    router.push(action.href);
                  }
                }}
                className="group cursor-pointer focus:bg-muted/70 data-[highlighted]:bg-muted/70 rounded-lg py-2 px-2"
              >
                <div
                  className={cn(
                    'flex items-center justify-center w-6 h-6 rounded-md mr-2.5 shrink-0 transition-all shadow-xs border',
                    action.colorClass
                  )}
                >
                  {React.cloneElement(action.icon, { className: 'h-3.5 w-3.5' })}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{action.label}</span>
                    {action.badge && (
                      <Badge
                        variant="neutral"
                        size="xs"
                        className="uppercase text-[8px] px-1 py-0 font-semibold"
                      >
                        {action.badge}
                      </Badge>
                    )}
                  </div>
                  {action.description && (
                    <span className="text-[10px] text-muted-foreground truncate leading-tight">
                      {action.description}
                    </span>
                  )}
                </div>
                {action.shortcut ? (
                  <DropdownMenuShortcut className="text-[9px] bg-muted px-1 py-0.5 rounded border border-border/50">
                    ⌘{action.shortcut}
                  </DropdownMenuShortcut>
                ) : (
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-all opacity-0 group-hover:opacity-100" />
                )}
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </div>

        <div className="py-1.5 px-3 bg-muted/40 border-t flex items-center justify-center gap-1.5 rounded-b-lg">
          <p className="text-[10px] text-muted-foreground font-medium">
            Press{' '}
            <kbd className="font-mono bg-background border border-border px-1 py-0.5 rounded text-foreground font-semibold">
              C
            </kbd>{' '}
            or{' '}
            <kbd className="font-mono bg-background border border-border px-1 py-0.5 rounded text-foreground font-semibold">
              ⌘C
            </kbd>{' '}
            to open
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
