'use client';

import React from 'react';
import { Menu, X } from 'lucide-react';
import { useModalState } from '@/hooks/useModalState';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

export default function SidebarMobileTrigger({ className }: { className?: string }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useModalState('sidebarMobileMenu');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      className={cn(
        'md:hidden flex items-center justify-center h-9 w-9 shrink-0 p-0 text-foreground hover:bg-accent',
        className
      )}
      aria-label="Toggle navigation menu"
      aria-expanded={isMobileMenuOpen}
    >
      {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
    </Button>
  );
}
