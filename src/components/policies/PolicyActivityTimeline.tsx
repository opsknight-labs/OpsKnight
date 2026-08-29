'use client';

import type React from 'react';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { formatDateTime } from '@/lib/timezone';
import {
  Activity,
  Plus,
  Trash2,
  ShieldAlert,
  Edit,
  Sparkles,
  ArrowUpDown,
  type LucideIcon,
} from 'lucide-react';

type AuditLogItem = {
  id: string;
  action: string;
  actorName?: string | null;
  actorEmail?: string | null;
  details?: unknown;
  createdAt: Date | string;
  actor?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
};

type PolicyActivityTimelineProps = {
  logs: AuditLogItem[];
  emptyMessage?: string;
};

function formatActionTitle(action: string): {
  label: string;
  icon: LucideIcon;
  variant: 'default' | 'secondary' | 'warning' | 'destructive' | 'info' | 'success';
} {
  switch (action) {
    case 'escalation_policy.created':
      return { label: 'Policy Created', icon: Sparkles, variant: 'success' };
    case 'escalation_policy.updated':
      return { label: 'Settings Updated', icon: Edit, variant: 'secondary' };
    case 'escalation_policy.deleted':
      return { label: 'Policy Deleted', icon: ShieldAlert, variant: 'destructive' };
    case 'escalation_policy.step_added':
      return { label: 'Step Added', icon: Plus, variant: 'info' };
    case 'escalation_policy.step_updated':
      return { label: 'Step Updated', icon: Edit, variant: 'secondary' };
    case 'escalation_policy.step_deleted':
      return { label: 'Step Removed', icon: Trash2, variant: 'warning' };
    case 'escalation_policy.step_moved':
    case 'escalation_policy.steps_reordered':
      return { label: 'Steps Reordered', icon: ArrowUpDown, variant: 'secondary' };
    default:
      return {
        label: action
          .replace(/^escalation_policy\./, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()),
        icon: Activity,
        variant: 'default',
      };
  }
}

export default function PolicyActivityTimeline({
  logs,
  emptyMessage = 'No recent activity recorded for this escalation policy.',
}: PolicyActivityTimelineProps) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground border border-dashed rounded-lg bg-slate-50/50">
        <Activity className="h-5 w-5 text-slate-300 mb-2" />
        <p className="text-xs">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-3 pl-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
      {logs.map(log => {
        const { label, icon: Icon, variant } = formatActionTitle(log.action);
        const actorName = log.actor?.name || log.actorName || log.actorEmail || 'System';
        const actorAvatar =
          log.actor?.avatarUrl || getDefaultAvatar(log.actor?.gender, log.actor?.id || actorName);

        const details: Record<string, unknown> =
          typeof log.details === 'object' && log.details !== null
            ? (log.details as Record<string, unknown>)
            : typeof log.details === 'string'
              ? (() => {
                  try {
                    return JSON.parse(log.details) as Record<string, unknown>;
                  } catch {
                    return { text: log.details };
                  }
                })()
              : {};

        return (
          <div key={log.id} className="relative flex items-start gap-3 text-xs">
            {/* Dot marker */}
            <div className="absolute -left-4 mt-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary ring-2 ring-primary/20" />

            <div className="flex-1 rounded-lg border border-border/70 bg-card p-3 shadow-2xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={variant} size="xs" className="gap-1 text-[10px] py-0 px-1.5">
                    <Icon className="h-2.5 w-2.5" />
                    {label}
                  </Badge>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatDateTime(new Date(log.createdAt), 'UTC', { format: 'relative' })}
                </span>
              </div>

              {/* Actor & details */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <DirectUserAvatar
                  avatarUrl={actorAvatar}
                  name={actorName}
                  size="xs"
                  className="h-4 w-4 shrink-0"
                />
                <span className="font-medium text-foreground">{actorName}</span>
                {typeof details.name === 'string' && (
                  <span>
                    policy:{' '}
                    <strong className="text-foreground font-semibold">{details.name}</strong>
                  </span>
                )}
                {typeof details.targetType === 'string' && (
                  <span>
                    target:{' '}
                    <strong className="text-foreground font-semibold">{details.targetType}</strong>
                  </span>
                )}
                {typeof details.delayMinutes === 'number' && (
                  <span>(+{details.delayMinutes}m)</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
