import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { ShieldCheck, ShieldAlert, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EvidenceIntegrityBadgeProps {
  readonly integrity: 'VERIFIED' | 'MISMATCH' | 'NONE';
  readonly count?: number;
  readonly className?: string;
}

export function EvidenceIntegrityBadge({
  integrity,
  count,
  className,
}: EvidenceIntegrityBadgeProps) {
  if (integrity === 'VERIFIED') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium text-xs gap-1 py-0.5 px-2',
          className
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span>Verified (SHA-256){count !== undefined && count > 0 ? ` (${count})` : ''}</span>
      </Badge>
    );
  }

  if (integrity === 'MISMATCH') {
    return (
      <Badge
        variant="destructive"
        className={cn(
          'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400 font-semibold text-xs gap-1 py-0.5 px-2',
          className
        )}
      >
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span>Integrity Mismatch{count !== undefined && count > 0 ? ` (${count})` : ''}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'border-border bg-muted/50 text-muted-foreground text-xs gap-1 py-0.5 px-2',
        className
      )}
    >
      <CircleDashed className="h-3.5 w-3.5 shrink-0" />
      <span>No Evidence</span>
    </Badge>
  );
}
