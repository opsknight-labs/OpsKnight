import { Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Team membership vocabulary shared by the team roster, team cards and the user profile.
 * Roles are neutral pills (status hues are reserved for incident state).
 */
export function TeamRoleBadge({ role, className }: { role: string; className?: string }) {
  const label =
    role === 'OWNER' ? 'Owner' : role === 'ADMIN' ? 'Admin' : role === 'LEAD' ? 'Lead' : 'Member';
  const elevated = role === 'OWNER' || role === 'ADMIN';
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-2xs',
        elevated
          ? 'border-ink-300 bg-ink-100 font-semibold text-foreground'
          : 'border-border bg-muted/50 font-medium text-muted-foreground',
        className
      )}
    >
      {label}
    </span>
  );
}

/** "Lead" marker for the team lead. */
export function TeamLeadMarker({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-ink-300 bg-ink-100 px-1.5 text-2xs font-semibold text-foreground',
        className
      )}
    >
      <Crown className="h-3 w-3" aria-hidden="true" />
      Lead
    </span>
  );
}
