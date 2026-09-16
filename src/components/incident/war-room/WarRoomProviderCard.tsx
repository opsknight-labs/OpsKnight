'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { ExternalLink, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { WarRoomLifecycleBadge } from './WarRoomLifecycleBadge';
import { WarRoomHealthBadge } from './WarRoomHealthBadge';
import { WarRoomParticipantSummary } from './WarRoomParticipantSummary';
import { WarRoomActionsMenu } from './WarRoomActionsMenu';
import { WarRoomDiagnostics } from './WarRoomDiagnostics';
import type { IncidentWarRoomProviderView } from '@/lib/incident-collaboration/types';
import {
  PROVIDER_PRESENTATION,
  toUserFacingWarRoomError,
} from '@/lib/incident-collaboration/presentation';
import { cn } from '@/lib/utils';

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
  const isSlack = providerView.provider === 'SLACK';

  const cardStyle = (() => {
    if (
      room.health === 'PERMISSION_ERROR' ||
      room.health === 'MISSING' ||
      room.state === 'FAILED'
    ) {
      return 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-rose-200 dark:border-rose-900/40 border-l-[3.5px] border-l-rose-500 hover:border-rose-300 dark:hover:border-rose-800/60 hover:shadow-xs';
    }
    if (room.health === 'DEGRADED' || isTransitioning) {
      return 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-amber-200 dark:border-amber-900/40 border-l-[3.5px] border-l-amber-500 hover:border-amber-300 dark:hover:border-amber-800/60 hover:shadow-xs';
    }
    if (room.state === 'READY') {
      return isSlack
        ? 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-emerald-200/80 dark:border-emerald-900/40 border-l-[3.5px] border-l-emerald-500 hover:border-emerald-300 dark:hover:border-emerald-800/60 hover:shadow-xs'
        : 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-indigo-200/80 dark:border-indigo-900/40 border-l-[3.5px] border-l-indigo-500 hover:border-indigo-300 dark:hover:border-indigo-800/60 hover:shadow-xs';
    }
    return 'bg-white/80 dark:bg-zinc-900/60 hover:bg-white dark:hover:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-800/80 border-l-[3.5px] border-l-zinc-300 dark:border-l-zinc-700 opacity-85 hover:opacity-100';
  })();

  return (
    <section
      className={cn(
        'group relative flex flex-col gap-3 p-3.5 rounded-xl border text-left transition-all duration-150 shadow-2xs',
        cardStyle,
        className
      )}
      aria-label={`${meta.displayName} war room`}
    >
      {/* Top Header Row with Icon and Room Title */}
      <div className="flex items-start gap-3">
        {/* Provider Icon Pill */}
        <div className="mt-0.5 shrink-0">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center shadow-2xs border',
              isSlack
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50 text-amber-600 dark:text-amber-400'
                : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400'
            )}
          >
            {isSlack ? (
              <SlackLogo className="h-4.5 w-4.5" />
            ) : (
              <MicrosoftTeamsLogo className="h-5 w-5" />
            )}
          </div>
        </div>

        {/* Content Column */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span
                className={cn(
                  'text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded border leading-none shrink-0',
                  isSlack
                    ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30'
                )}
              >
                {meta.displayName}
              </span>
              {room.membershipType === 'PRIVATE' && (
                <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded border leading-none shrink-0 bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
                  Private
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {room.state === 'READY' && room.health === 'HEALTHY' && (
                <span className="relative flex h-2 w-2 shrink-0" title="Active">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-emerald-500" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
              <WarRoomLifecycleBadge state={room.state} />
              {hasProblem && <WarRoomHealthBadge health={room.health} />}
            </div>
          </div>

          <h4 className="text-xs font-semibold leading-snug truncate text-zinc-900 dark:text-zinc-100">
            {room.channelName ? (
              <span>#{room.channelName}</span>
            ) : isTransitioning ? (
              <span className="italic text-zinc-500 dark:text-zinc-400">Setting up channel…</span>
            ) : (
              <span>{meta.displayName} War Room</span>
            )}
          </h4>

          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
            {isTransitioning
              ? room.state === 'CLOSING'
                ? 'Archiving and unlinking collaboration room…'
                : 'Configuring dedicated room, bot access, and responders…'
              : `Active ${meta.displayName} collaboration space for real-time triage and resolution.`}
          </p>
        </div>
      </div>

      {/* Diagnostics / Problem Banner */}
      {hasProblem && friendlyError && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
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
            <span className="font-semibold block leading-tight">{friendlyError.title}</span>
            {friendlyError.description && (
              <span className="text-[11px] text-amber-700/90 dark:text-amber-300/90 block mt-0.5 leading-relaxed">
                {friendlyError.description}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Responders / Participant Summary with grey background layer */}
      {room.participants && (
        <div className="rounded-lg bg-zinc-50/90 dark:bg-zinc-800/40 p-2.5 border border-zinc-200/70 dark:border-zinc-800/60">
          <WarRoomParticipantSummary participants={room.participants} />
        </div>
      )}

      {/* Footer Actions */}
      <div className="pt-2 flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800/60">
        <div>
          {room.actions.canOpen && room.channelUrl ? (
            <Button
              asChild
              size="sm"
              className="h-8 text-xs font-medium gap-1.5 px-3 rounded-lg shadow-2xs group/btn"
            >
              <a
                href={room.deepLinkUrl || room.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${room.channelName || meta.displayName} in ${meta.displayName}`}
              >
                <span>{meta.openActionLabel}</span>
                <ExternalLink
                  className="h-3 w-3 group-hover/btn:translate-x-0.5 transition-transform"
                  aria-hidden="true"
                />
              </a>
            </Button>
          ) : isTransitioning ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-medium py-1 px-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{room.state === 'CLOSING' ? 'Closing channel…' : 'Connecting channel…'}</span>
            </div>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">
              Channel not accessible
            </span>
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
