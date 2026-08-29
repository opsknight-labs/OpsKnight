'use client';

import {
  ArrowUpDown,
  CalendarPlus,
  History,
  Layers,
  ShieldAlert,
  ShieldPlus,
  Sliders,
  Trash2,
  UserMinus,
  UserPlus,
  Settings2,
  Activity,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';

export type ScheduleAuditItem = {
  id: string;
  action: string;
  actorName?: string | null;
  actorEmail?: string | null;
  details?: unknown;
  createdAt: Date;
  actor?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
};

interface ActionMeta {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
}

type ScheduleAuditDetails = Record<string, unknown>;

function isScheduleAuditDetails(value: unknown): value is ScheduleAuditDetails {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDetailText(
  details: ScheduleAuditDetails | undefined,
  key: 'name' | 'timeZone' | 'direction' | 'userName'
): string | undefined {
  const value =
    key === 'name'
      ? details?.name
      : key === 'timeZone'
        ? details?.timeZone
        : key === 'direction'
          ? details?.direction
          : details?.userName;
  return typeof value === 'string' ? value : undefined;
}

function getActionMeta(action: string, rawDetails?: unknown): ActionMeta {
  const details = isScheduleAuditDetails(rawDetails) ? rawDetails : undefined;
  const name = getDetailText(details, 'name');
  const timeZone = getDetailText(details, 'timeZone');
  const direction = getDetailText(details, 'direction');
  const userName = getDetailText(details, 'userName');
  switch (action) {
    case 'schedule.created':
      return {
        title: 'Schedule created',
        description: name ? `Created schedule "${name}"` : undefined,
        icon: CalendarPlus,
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-500/10 border-blue-500/20',
      };
    case 'schedule.updated':
      return {
        title: 'Schedule settings updated',
        description:
          name || timeZone
            ? [name && `Name: ${name}`, timeZone && `Time zone: ${timeZone}`]
                .filter(Boolean)
                .join(' · ')
            : undefined,
        icon: Settings2,
        iconColor: 'text-slate-600 dark:text-slate-400',
        iconBg: 'bg-slate-500/10 border-slate-500/20',
      };
    case 'schedule.layer.created':
      return {
        title: 'Rotation layer created',
        description: name ? `Added layer "${name}"` : undefined,
        icon: Layers,
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        iconBg: 'bg-emerald-500/10 border-emerald-500/20',
      };
    case 'schedule.layer.updated':
      return {
        title: 'Layer settings updated',
        description: name ? `Updated "${name}"` : undefined,
        icon: Sliders,
        iconColor: 'text-indigo-600 dark:text-indigo-400',
        iconBg: 'bg-indigo-500/10 border-indigo-500/20',
      };
    case 'schedule.layer.deleted':
      return {
        title: 'Rotation layer deleted',
        icon: Trash2,
        iconColor: 'text-rose-600 dark:text-rose-400',
        iconBg: 'bg-rose-500/10 border-rose-500/20',
      };
    case 'schedule.layer.precedence_updated':
    case 'schedule.layer.reordered':
      return {
        title: 'Layer precedence reordered',
        description: direction ? `Moved layer ${direction}` : undefined,
        icon: ArrowUpDown,
        iconColor: 'text-violet-600 dark:text-violet-400',
        iconBg: 'bg-violet-500/10 border-violet-500/20',
      };
    case 'schedule.layer.member_added':
    case 'schedule.member.added':
      return {
        title: 'Responder assigned to layer',
        description: userName ? `Added ${userName}` : undefined,
        icon: UserPlus,
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        iconBg: 'bg-emerald-500/10 border-emerald-500/20',
      };
    case 'schedule.layer.member_removed':
    case 'schedule.member.removed':
      return {
        title: 'Responder removed from layer',
        icon: UserMinus,
        iconColor: 'text-amber-600 dark:text-amber-400',
        iconBg: 'bg-amber-500/10 border-amber-500/20',
      };
    case 'schedule.layer.member_moved':
    case 'schedule.member.reordered':
      return {
        title: 'Responder rotation order shifted',
        description: direction ? `Shifted ${direction}` : undefined,
        icon: ArrowUpDown,
        iconColor: 'text-sky-600 dark:text-sky-400',
        iconBg: 'bg-sky-500/10 border-sky-500/20',
      };
    case 'schedule.override.created':
      return {
        title: 'Temporary override created',
        icon: ShieldPlus,
        iconColor: 'text-amber-600 dark:text-amber-400',
        iconBg: 'bg-amber-500/10 border-amber-500/20',
      };
    case 'schedule.override.deleted':
      return {
        title: 'Temporary override removed',
        icon: ShieldAlert,
        iconColor: 'text-slate-600 dark:text-slate-400',
        iconBg: 'bg-slate-500/10 border-slate-500/20',
      };
    default: {
      const formatted = action
        .replace(/^schedule\./, '')
        .replaceAll('.', ' ')
        .replaceAll('_', ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return {
        title: formatted,
        icon: Activity,
        iconColor: 'text-primary',
        iconBg: 'bg-primary/10 border-primary/20',
      };
    }
  }
}

export default function ScheduleActivityFeed({
  auditLogs,
  timeZone,
}: {
  auditLogs: ScheduleAuditItem[];
  timeZone: string;
}) {
  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="border-b bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <History className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Recent schedule changes</CardTitle>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground">
              Audit trail of rotation layers, responders, and schedule updates.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {auditLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
              <History className="h-5 w-5 opacity-60" />
            </div>
            <p className="text-sm font-medium text-foreground">No recorded changes yet</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              Modifications to layers, overrides, and schedule settings will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {auditLogs.map(log => {
              const meta = getActionMeta(log.action, log.details);
              const Icon = meta.icon;
              const actorName = log.actor?.name || log.actorName || 'System';
              const relativeTime = formatDateTime(log.createdAt, timeZone, {
                format: 'relative',
              });
              const absoluteTime = formatDateTime(log.createdAt, timeZone, { format: 'short' });

              return (
                <div
                  key={log.id}
                  className="flex items-start justify-between gap-3 px-5 py-3.5 sm:px-6 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                        meta.iconBg,
                        meta.iconColor
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground leading-snug">
                        {meta.title}
                      </p>
                      {meta.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {meta.description}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {log.actor ? (
                          <div className="flex items-center gap-1.5 font-medium text-foreground/80">
                            <DirectUserAvatar
                              avatarUrl={
                                log.actor.avatarUrl ||
                                getDefaultAvatar(log.actor.gender, log.actor.id || log.actor.name)
                              }
                              name={log.actor.name}
                              size="xs"
                              className="h-3.5 w-3.5"
                            />
                            <span>{actorName}</span>
                          </div>
                        ) : (
                          <span className="font-medium text-foreground/80">{actorName}</span>
                        )}
                        <span>·</span>
                        <span title={absoluteTime}>{relativeTime}</span>
                      </div>
                    </div>
                  </div>

                  <span
                    className="hidden sm:inline-block shrink-0 text-xs text-muted-foreground/80 tabular-nums pt-0.5"
                    title={relativeTime}
                  >
                    {absoluteTime}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
