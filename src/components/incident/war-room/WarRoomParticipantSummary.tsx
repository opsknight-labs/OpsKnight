'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Users, Check, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IncidentWarRoomParticipantView } from '@/lib/incident-collaboration/types';

type WarRoomParticipantSummaryProps = {
  participants: {
    synced: number;
    pending: number;
    attentionRequired: number;
    total: number;
    items: IncidentWarRoomParticipantView[];
  };
  className?: string;
};

export function WarRoomParticipantSummary({
  participants,
  className,
}: WarRoomParticipantSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const { synced, pending, attentionRequired, total, items } = participants;

  if (total === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground flex items-center gap-1.5', className)}>
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>No responders synced yet</span>
      </div>
    );
  }

  const summaryText = (() => {
    const parts: string[] = [];
    if (synced > 0) parts.push(`${synced} synced`);
    if (pending > 0) parts.push(`${pending} pending`);
    if (attentionRequired > 0) parts.push(`${attentionRequired} needs attention`);
    return parts.join(' · ') || `${total} responders`;
  })();

  return (
    <div className={cn('text-xs space-y-2', className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left font-medium text-foreground hover:text-primary transition-colors py-1 group"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5">
          <Users
            className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0"
            aria-hidden="true"
          />
          <span className="font-semibold">Responders</span>
          <span className="text-muted-foreground">({summaryText})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expanded && items.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-md border border-border/80 bg-muted/30 px-3 py-1 space-y-1.5 list-none">
          {items.map((item, idx) => {
            const isSynced = item.state === 'PRESENT';
            const isAttention = item.lastError || item.state === 'SKIPPED';
            const statusLabel = isAttention
              ? item.lastError || 'Identity link required'
              : isSynced
                ? 'Synced'
                : 'Pending';

            return (
              <li
                key={item.id || `${item.userId || 'unknown'}-${idx}`}
                className="flex items-center justify-between py-1.5 text-xs first:pt-1 last:pb-1"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  {isSynced ? (
                    <Check
                      className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                      aria-hidden="true"
                    />
                  ) : isAttention ? (
                    <AlertCircle
                      className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <Clock
                      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="font-medium text-foreground truncate">{item.name}</span>
                  {item.email && (
                    <span className="text-muted-foreground text-[11px] truncate hidden sm:inline">
                      ({item.email})
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'text-[11px] font-medium shrink-0',
                    isSynced
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : isAttention
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-muted-foreground'
                  )}
                >
                  {statusLabel}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
