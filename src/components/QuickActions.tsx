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
  Command,
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
    const handleOpen = () => setOpen(true);
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
          className="h-9 gap-1.5 font-semibold shadow-sm transition-all duration-300 active:scale-95 bg-primary hover:bg-primary/90 text-primary-foreground border border-primary/20"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 p-0 overflow-hidden border border-border shadow-xl bg-white/95 backdrop-blur-xl z-[1050]"
      >
        {/* Compact Header */}
        <div className="relative p-2 bg-gradient-to-br from-primary/90 via-primary to-primary/90 text-primary-foreground overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_50%)]" />

          <div className="relative z-10 flex items-center gap-2">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-white/10 border border-white/20 shadow-sm backdrop-blur-md">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-xs font-semibold truncate leading-none text-white">Create New</p>
              <p className="text-[8px] text-primary-foreground/80 font-medium truncate">
                Select resource type
              </p>
            </div>
          </div>
        </div>

        <div className="p-0.5">
          {quickActions.map((action, index) => (
            <React.Fragment key={action.href}>
              {index === 2 && <DropdownMenuSeparator className="my-0.5 bg-border/60" />}
              <DropdownMenuItem
                onClick={() => {
                  if (action.label === 'New Incident') {
                    openCreateIncident();
                  } else {
                    router.push(action.href);
                  }
                }}
                className="group cursor-pointer focus:bg-muted/60 data-[highlighted]:bg-muted/60 rounded py-1 px-1.5"
              >
                <div
                  className={cn(
                    'flex items-center justify-center w-5 h-5 rounded-full mr-2 shrink-0 transition-all shadow-sm border',
                    action.colorClass
                  )}
                >
                  {React.cloneElement(action.icon, { className: 'h-3 w-3' })}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-foreground">{action.label}</span>
                    {action.badge && (
                      <Badge variant="neutral" size="xs" className="uppercase text-[7px] px-1 py-0">
                        {action.badge}
                      </Badge>
                    )}
                  </div>
                  {action.description && (
                    <span className="text-[8px] text-muted-foreground truncate leading-tight">
                      {action.description}
                    </span>
                  )}
                </div>
                {action.shortcut ? (
                  <DropdownMenuShortcut className="text-[8px] bg-muted px-0.5 rounded border border-border/50">
                    ⌘{action.shortcut}
                  </DropdownMenuShortcut>
                ) : (
                  <ArrowRight className="h-2 w-2 text-muted-foreground/30 group-hover:text-primary transition-all opacity-0 group-hover:opacity-100" />
                )}
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </div>

        <div className="p-1 bg-muted/30 border-t flex items-center justify-center gap-1.5">
          <Command className="h-2 w-2 text-muted-foreground" />
          <p className="text-[8px] text-muted-foreground">
            Press{' '}
            <kbd className="font-mono bg-muted border border-border/50 px-0.5 rounded text-foreground font-medium">
              C
            </kbd>{' '}
            to open
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
