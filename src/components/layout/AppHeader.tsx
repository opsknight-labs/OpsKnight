'use client';

import React from 'react';
import { useSidebar } from '@/contexts/SidebarContext';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export default function AppHeader({ children, className }: AppHeaderProps) {
  const { isCollapsed, isMobile } = useSidebar();

  return (
    <header
      className={cn(
        'app-header fixed top-0 right-0 z-30 flex h-14 items-center justify-between gap-2 sm:gap-3 border-b bg-background px-3 sm:px-4 transition-[left] duration-200 ease-in-out',
        isMobile
          ? 'left-0'
          : isCollapsed
            ? 'left-[var(--sidebar-width-collapsed)]'
            : 'left-[var(--sidebar-width)]',
        className
      )}
    >
      {children}
    </header>
  );
}
