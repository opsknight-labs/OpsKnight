'use client';

import React from 'react';
import { PanelLeft } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/shadcn/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { cn } from '@/lib/utils';

interface SidebarTriggerProps {
  className?: string;
}

export default function SidebarTrigger({ className }: SidebarTriggerProps) {
  const { isCollapsed, isMobile, toggleSidebar, toggleMobile, isMobileOpen } = useSidebar();

  const isMac =
    typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(window.navigator.platform || '');
  const shortcutLabel = isMac ? '⌘B' : 'Ctrl+B';

  const handleClick = () => {
    if (isMobile) {
      toggleMobile();
    } else {
      toggleSidebar();
    }
  };

  const isExpanded = isMobile ? isMobileOpen : !isCollapsed;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClick}
            className={cn(
              'h-8 w-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-95',
              className
            )}
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={isExpanded}
            aria-controls="app-sidebar"
            aria-keyshortcuts="Meta+B"
          >
            <PanelLeft className="h-4.5 w-4.5 stroke-[1.8]" />
            <span className="sr-only">{isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="text-xs flex items-center gap-1.5 py-1 px-2"
        >
          <span>{isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}</span>
          <kbd className="text-[10px] font-mono bg-muted/80 text-muted-foreground px-1 py-0.5 rounded border border-border/60">
            {shortcutLabel}
          </kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
