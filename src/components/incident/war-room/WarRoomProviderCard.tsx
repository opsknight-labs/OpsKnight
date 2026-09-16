'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { ExternalLink, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { WarRoomProviderHeader } from './WarRoomProviderHeader';
import { WarRoomParticipantSummary } from './WarRoomParticipantSummary';
import { WarRoomActionsMenu } from './WarRoomActionsMenu';
import { WarRoomDiagnostics } from './WarRoomDiagnostics';
import type { IncidentWarRoomProviderView } from '@/lib/incident-collaboration/types';
import {
  PROVIDER_PRESENTATION,
  toUserFacingWarRoomError,
} from '@/lib/incident-collaboration/presentation';

type WarRoomProviderCardProps = {
  providerView: IncidentWarRoomProviderView;
  onAction: (action: string, roomId: string) => Promise<void> | void;
  pendingAction?: { roomId?: string; action: string } | null;
  className?: string;
};

export function WarRoomProviderCard({
  providerView,
  onAction,
  pendingAction,
  className,
}: WarRoomProviderCardProps) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const room = providerView.currentRoom;
  const meta = PROVIDER_PRESENTATION[providerView.provider];

  if (!room) return null;

  const isTransitioning = ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'CLOSING'].includes(
    room.state
  );
  const hasProblem = room.health !== 'HEALTHY';
  const friendlyError = room.lastError ? toUserFacingWarRoomError(room.lastError) : null;

  return (
    <section
      className={`rounded-xl border border-border bg-card p-4 shadow-sm space-y-3.5 transition-all text-card-foreground ${className || ''}`}
      aria-label={`${meta.displayName} war room`}
    >
      <WarRoomProviderHeader
        provider={providerView.provider}
        state={room.state}
        health={room.health}
      />

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground truncate">
            {room.channelName ? (
              <span>#{room.channelName}</span>
            ) : isTransitioning ? (
              <span className="italic text-muted-foreground">Setting up channel…</span>
            ) : (
              <span>{meta.displayName} War Room</span>
            )}
          </h4>
          {room.membershipType === 'PRIVATE' && (
            <span className="text-[11px] font-medium text-muted-foreground shrink-0 uppercase tracking-wider bg-muted px-1.5 py-0.5 rounded">
              Private
            </span>
          )}
        </div>

        {hasProblem && friendlyError && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2 mt-2">
            {room.health === 'PERMISSION_ERROR' ? (
              <ShieldAlert
                className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <span className="font-semibold block">{friendlyError.title}</span>
              {friendlyError.description && (
                <span className="text-[11px] text-amber-700/90 dark:text-amber-300/90 block">
                  {friendlyError.description}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {room.participants && (
        <div className="pt-1 border-t border-border/60">
          <WarRoomParticipantSummary participants={room.participants} />
        </div>
      )}

      <div className="pt-2 flex items-center justify-between gap-2">
        <div>
          {room.actions.canOpen && room.channelUrl ? (
            <Button asChild size="sm" className="h-9 font-medium gap-1.5 px-3">
              <a
                href={room.deepLinkUrl || room.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${room.channelName || meta.displayName} in ${meta.displayName}`}
              >
                <span>{meta.openActionLabel}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          ) : isTransitioning ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium py-1 px-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{room.state === 'CLOSING' ? 'Closing channel…' : 'Connecting channel…'}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">Channel not accessible</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <WarRoomActionsMenu
            room={room}
            onAction={onAction}
            pendingAction={pendingAction}
            onViewDiagnostics={() => setShowDiagnostics(true)}
          />
        </div>
      </div>

      <WarRoomDiagnostics room={room} open={showDiagnostics} onOpenChange={setShowDiagnostics} />
    </section>
  );
}
