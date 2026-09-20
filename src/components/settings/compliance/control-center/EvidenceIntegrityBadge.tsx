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
        <span>
          Latest SHA-256 Valid
          {count !== undefined && count > 0 ? ` (${count} record${count === 1 ? '' : 's'})` : ''}
        </span>
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
        <span>
          Latest Integrity Mismatch
          {count !== undefined && count > 0 ? ` (${count} record${count === 1 ? '' : 's'})` : ''}
        </span>
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
      <span>
        {count !== undefined && count > 0
          ? `${count} unverified record${count === 1 ? '' : 's'}`
          : 'No Evidence'}
      </span>
    </Badge>
  );
}
