'use client';

import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, AlertTriangle, AlertCircle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WarRoomPresentationHealth } from '@/lib/incident-collaboration/types';
import { getHealthPresentation } from '@/lib/incident-collaboration/presentation';

type WarRoomHealthBadgeProps = {
  health: WarRoomPresentationHealth;
  className?: string;
  showIcon?: boolean;
};

export function WarRoomHealthBadge({
  health,
  className,
  showIcon = true,
}: WarRoomHealthBadgeProps) {
  const presentation = getHealthPresentation(health);

  const { toneClasses, Icon } = (() => {
    switch (health) {
      case 'HEALTHY':
        return {
          toneClasses:
            'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
          Icon: CheckCircle2,
        };
      case 'DEGRADED':
        return {
          toneClasses: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
          Icon: AlertTriangle,
        };
      case 'PERMISSION_ERROR':
        return {
          toneClasses: 'bg-destructive/10 text-destructive border-destructive/20',
          Icon: ShieldAlert,
        };
      case 'MISSING':
      default:
        return {
          toneClasses: 'bg-destructive/10 text-destructive border-destructive/20',
          Icon: AlertCircle,
        };
    }
  })();

  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={`War room health: ${presentation.label}`}
      className={cn(
        'inline-flex items-center gap-1 font-mono font-bold text-[9px] tracking-wider uppercase px-1.5 py-0.5 rounded border leading-none',
        toneClasses,
        className
      )}
    >
      {showIcon && <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
      <span>{presentation.label}</span>
    </Badge>
  );
}
