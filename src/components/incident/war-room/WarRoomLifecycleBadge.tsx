'use client';

import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WarRoomPresentationLifecycle } from '@/lib/incident-collaboration/types';
import { getLifecyclePresentation } from '@/lib/incident-collaboration/presentation';

type WarRoomLifecycleBadgeProps = {
  state: WarRoomPresentationLifecycle;
  className?: string;
};

export function WarRoomLifecycleBadge({ state, className }: WarRoomLifecycleBadgeProps) {
  const presentation = getLifecyclePresentation(state);
  const isTransitioning = ['PROVISIONING', 'AMBIGUOUS', 'CLOSING'].includes(state);

  const toneClasses = (() => {
    switch (presentation.tone) {
      case 'success':
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
      case 'warning':
        return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
      case 'info':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
      case 'destructive':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  })();

  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={`War room lifecycle: ${presentation.label}`}
      className={cn(
        'inline-flex items-center gap-1 font-semibold text-[10px] tracking-wide uppercase px-1.5 py-0.5 rounded border leading-none',
        toneClasses,
        className
      )}
    >
      {isTransitioning ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" aria-hidden="true" />
      ) : presentation.tone === 'success' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
      ) : null}
      <span>{presentation.label}</span>
    </Badge>
  );
}
