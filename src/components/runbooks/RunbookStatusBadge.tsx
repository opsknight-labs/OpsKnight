import React from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  ShieldAlert,
  ShieldX,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';

export type RunbookStatusBadgeProps = {
  status: string;
  className?: string;
  showIcon?: boolean;
  size?: 'sm' | 'default';
};

export function RunbookStatusBadge({
  status,
  className,
  showIcon = true,
  size = 'default',
}: RunbookStatusBadgeProps) {
  const normalized = (status || '').toUpperCase();

  // Pick semantic visual configuration
  let label = normalized.replaceAll('_', ' ');
  let icon: React.ReactNode = null;
  let variant: 'success' | 'danger' | 'warning' | 'info' | 'secondary' = 'secondary';
  let customStyle = '';

  switch (normalized) {
    // Executions
    case 'SUCCEEDED':
      variant = 'success';
      label = 'Succeeded';
      icon = <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />;
      break;
    case 'RUNNING':
      variant = 'info';
      label = 'Running';
      icon = (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
      );
      customStyle = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
      break;
    case 'QUEUED':
      variant = 'secondary';
      label = 'Queued';
      icon = <Clock className="h-3 w-3 text-muted-foreground shrink-0" />;
      break;
    case 'CLAIMED':
      variant = 'info';
      label = 'Claimed';
      icon = <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />;
      break;
    case 'WAITING_APPROVAL':
      variant = 'warning';
      label = 'Waiting Approval';
      icon = <ShieldAlert className="h-3 w-3 text-amber-500 shrink-0" />;
      customStyle = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
      break;
    case 'WAITING_AGENT':
      variant = 'warning';
      label = 'Waiting Agent';
      icon = <Clock className="h-3 w-3 text-amber-500 shrink-0" />;
      customStyle = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
      break;
    case 'FAILED':
      variant = 'danger';
      label = 'Failed';
      icon = <XCircle className="h-3 w-3 text-rose-500 shrink-0" />;
      break;
    case 'UNKNOWN':
      variant = 'danger';
      label = 'Unknown Outcome';
      icon = <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />;
      customStyle = 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30';
      break;
    case 'CANCELLED':
    case 'CANCEL_REQUESTED':
      variant = 'secondary';
      label = normalized === 'CANCEL_REQUESTED' ? 'Cancel Requested' : 'Cancelled';
      icon = <Ban className="h-3 w-3 text-muted-foreground shrink-0" />;
      break;
    case 'TIMED_OUT':
      variant = 'danger';
      label = 'Timed Out';
      icon = <Hourglass className="h-3 w-3 text-rose-500 shrink-0" />;
      break;

    case 'PAUSED':
      variant = 'warning'; label = 'Paused'; icon = <Clock className="h-3 w-3 shrink-0" />; break;

    // Agent Fleet
    case 'ONLINE':
      variant = 'success';
      label = 'Online';
      icon = (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      );
      break;
    case 'DEGRADED':
      variant = 'warning';
      label = 'Degraded';
      icon = <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />;
      break;
    case 'OFFLINE':
      variant = 'danger';
      label = 'Offline';
      icon = <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />;
      break;
    case 'REVOKED':
      variant = 'secondary';
      label = 'Revoked';
      icon = <ShieldX className="h-3 w-3 text-muted-foreground shrink-0" />;
      break;
    case 'ENROLLING':
      variant = 'info';
      label = 'Enrolling';
      icon = <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />;
      break;

    // Runbook Lifecycle
    case 'PUBLISHED':
      variant = 'success';
      label = 'Published';
      icon = <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />;
      break;
    case 'DRAFT':
      variant = 'warning';
      label = 'Draft';
      customStyle = 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
      break;
    case 'ARCHIVED':
      variant = 'secondary';
      label = 'Archived';
      customStyle = 'bg-muted text-muted-foreground border-border';
      break;

    // Health states
    case 'HEALTHY':
      variant = 'success';
      label = 'Healthy';
      icon = <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />;
      break;
    default:
      variant = 'secondary';
      break;
  }

  return (
    <Badge
      variant={variant}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium tracking-wide transition-colors',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs',
        customStyle,
        className
      )}
    >
      {showIcon && icon}
      <span>{label}</span>
    </Badge>
  );
}
