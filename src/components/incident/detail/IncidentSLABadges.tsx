'use client';

import type { IncidentSlaState } from '@/lib/incident-sla/state';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import SLAIndicator from '../SLAIndicator';

type IncidentSLABadgesProps = {
  sla: IncidentSlaState | null;
  className?: string;
};

export default function IncidentSLABadges({ sla, className }: IncidentSLABadgesProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1.5', className)}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/90">
        <Activity className="h-3.5 w-3.5 text-primary/70 shrink-0" />
        <span>Response Health</span>
      </span>
      <SLAIndicator sla={sla} />
    </div>
  );
}
