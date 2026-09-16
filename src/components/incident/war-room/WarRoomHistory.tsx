'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History, ExternalLink } from 'lucide-react';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { WarRoomLifecycleBadge } from './WarRoomLifecycleBadge';
import type { IncidentWarRoomHistoryItem } from '@/lib/incident-collaboration/types';
import { PROVIDER_PRESENTATION } from '@/lib/incident-collaboration/presentation';

type WarRoomHistoryProps = {
  history: IncidentWarRoomHistoryItem[];
  className?: string;
};

export function WarRoomHistory({ history, className }: WarRoomHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className={`rounded-xl border border-border bg-card p-4 space-y-3 ${className || ''}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left font-medium text-foreground hover:text-primary transition-colors py-0.5 group"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <History
            className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">Previous war rooms</span>
          <span className="text-xs text-muted-foreground">({history.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-muted/20 px-3 py-1 space-y-1 list-none text-xs">
          {history.map(item => {
            const meta = PROVIDER_PRESENTATION[item.provider];
            const timestamp = item.closedAt || item.archivedAt || item.createdAt;
            const formattedDate = new Date(timestamp).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <li
                key={item.id}
                className="flex items-center justify-between py-2 first:pt-1.5 last:pb-1.5"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <div className="shrink-0">
                    {item.provider === 'SLACK' ? (
                      <SlackLogo className="h-3.5 w-3.5" />
                    ) : (
                      <MicrosoftTeamsLogo className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="font-medium text-foreground block truncate">
                      {item.channelName ? `#${item.channelName}` : meta.displayName}
                    </span>
                    <span className="text-[11px] text-muted-foreground block">{formattedDate}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <WarRoomLifecycleBadge state={item.state} />
                  {item.channelUrl && (
                    <a
                      href={item.deepLinkUrl || item.channelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label={`Open archived ${item.channelName || meta.displayName} channel`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
