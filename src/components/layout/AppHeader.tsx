'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export default function AppHeader({ children, className }: AppHeaderProps) {
  return (
    <header
      id="app-header"
      className={cn(
        'app-header fixed top-0 left-0 right-0 z-40 flex h-14 w-full items-center justify-between gap-2 sm:gap-4 border-b border-slate-800/80 bg-[#0b1120]/95 backdrop-blur-md px-3 sm:px-4 select-none text-slate-100',
        className
      )}
    >
      {children}
    </header>
  );
}
