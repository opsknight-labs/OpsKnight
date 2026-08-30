'use client';

import React, { useState } from 'react';
import UserAvatar from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import EmptyState from '@/components/ui/EmptyState';
import { Activity, ChevronDown, ChevronUp, Clock, History } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActivityTimelineItem = {
  id: string;
  action: string;
  createdAt: Date | string;
  actor?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  details?: Record<string, unknown> | string | null;
};

export type ActivityTimelineProps = {
  items: ActivityTimelineItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  limit?: number;
};

function formatActionBadge(action: string): {
  label: string;
  variant:
    | 'default'
    | 'secondary'
    | 'outline'
    | 'danger'
    | 'success'
    | 'warning'
    | 'neutral'
    | 'info';
} {
  const normalized = action.toLowerCase();
  if (normalized.includes('create') || normalized.includes('add')) {
    return { label: action, variant: 'success' };
  }
  if (normalized.includes('delete') || normalized.includes('remove')) {
    return { label: action, variant: 'danger' };
  }
  if (
    normalized.includes('update') ||
    normalized.includes('edit') ||
    normalized.includes('change')
  ) {
    return { label: action, variant: 'info' };
  }
  return { label: action, variant: 'secondary' };
}

export default function ActivityTimeline({
  items,
  emptyTitle = 'No activity recorded',
  emptyDescription = 'Activity and audit logs will appear here when changes occur.',
  className,
  limit,
}: ActivityTimelineProps) {
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const displayItems = limit ? items.slice(0, limit) : items;

  if (displayItems.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-6 w-6" />}
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        'relative space-y-4 pl-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60',
        className
      )}
    >
      {displayItems.map(item => {
        const badgeInfo = formatActionBadge(item.action);
        const isExpanded = expandedItemIds.has(item.id);
        const hasDetails = item.details !== null && item.details !== undefined;
        const formattedDate = new Date(item.createdAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div key={item.id} className="relative group">
            {/* Timeline Dot Indicator */}
            <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary ring-2 ring-primary/20 group-hover:scale-125 transition-transform" />

            <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4 shadow-2xs space-y-2.5 transition-colors hover:border-border/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {item.actor ? (
                    <UserAvatar
                      userId={item.actor.id || ''}
                      name={item.actor.name || item.actor.email || 'System'}
                      avatarUrl={item.actor.avatarUrl}
                      gender={item.actor.gender}
                      size="sm"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs font-bold">
                      <Activity className="h-3.5 w-3.5" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-foreground">
                        {item.actor?.name || item.actor?.email || 'System'}
                      </span>
                      <Badge
                        variant={badgeInfo.variant}
                        size="xs"
                        className="font-mono text-[10px]"
                      >
                        {badgeInfo.label}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
                  <Clock className="h-3 w-3" />
                  <span>{formattedDate}</span>
                </div>
              </div>

              {/* Expandable JSON Detail Payload */}
              {hasDetails && (
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpand(item.id)}
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1 -ml-1"
                  >
                    <span>{isExpanded ? 'Hide Details' : 'View Payload Details'}</span>
                    {isExpanded ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </Button>

                  {isExpanded && (
                    <div className="mt-2 rounded-lg bg-muted/50 p-3 border border-border/50 text-[11px] font-mono text-muted-foreground overflow-x-auto">
                      <pre className="whitespace-pre-wrap break-all">
                        {typeof item.details === 'object'
                          ? JSON.stringify(item.details, null, 2)
                          : String(item.details)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
