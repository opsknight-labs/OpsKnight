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
  DropdownMenuLabel,
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
  ChevronDown,
  LayoutTemplate,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

type QuickAction = {
  label: string;
  href: string;
  icon: React.ReactElement;
  description?: string;
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
      icon: <Zap />,
      shortcut: 'I',
    },
    {
      label: 'New Template',
      href: '/incidents/templates/create',
      description: 'Create incident template',
      icon: <LayoutTemplate />,
    },
    {
      label: 'New Postmortem',
      href: '/postmortems/create',
      description: 'Create retrospective report',
      icon: <FileText />,
    },
    {
      label: 'New Service',
      href: '/services',
      description: 'Register a new microservice',
      icon: <Server />,
      shortcut: 'S',
    },
    {
      label: 'New Team',
      href: '/teams',
      description: 'Create a response team',
      icon: <Users />,
    },
    {
      label: 'New Schedule',
      href: '/schedules',
      description: 'Set up on-call rotation',
      icon: <Calendar />,
    },
    {
      label: 'New Policy',
      href: '/policies',
      description: 'Define escalation rules',
      icon: <Shield />,
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
      <DropdownMenuContent align="end" className="z-[1050] w-72">
        <DropdownMenuLabel>Create new</DropdownMenuLabel>
        {quickActions.map((action, index) => (
          <React.Fragment key={action.href}>
            {index === 2 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => {
                if (action.label === 'New Incident') {
                  openCreateIncident();
                } else {
                  router.push(action.href);
                }
              }}
            >
              {action.icon}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  {action.label}
                  {action.badge && (
                    <Badge variant="neutral" size="xs" className="uppercase">
                      {action.badge}
                    </Badge>
                  )}
                </span>
                {action.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {action.description}
                  </span>
                )}
              </span>
              {action.shortcut && <DropdownMenuShortcut>⌘{action.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Press <kbd className="font-mono text-foreground">C</kbd> or{' '}
          <kbd className="font-mono text-foreground">⌘C</kbd> to open
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
