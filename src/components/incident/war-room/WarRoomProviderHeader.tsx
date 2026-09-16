'use client';

import React from 'react';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { WarRoomLifecycleBadge } from './WarRoomLifecycleBadge';
import { WarRoomHealthBadge } from './WarRoomHealthBadge';
import type {
  WarRoomPresentationHealth,
  WarRoomPresentationLifecycle,
  WarRoomProviderName,
} from '@/lib/incident-collaboration/types';
import { PROVIDER_PRESENTATION } from '@/lib/incident-collaboration/presentation';

type WarRoomProviderHeaderProps = {
  provider: WarRoomProviderName;
  state?: WarRoomPresentationLifecycle | null;
  health?: WarRoomPresentationHealth | null;
  className?: string;
};

export function WarRoomProviderHeader({
  provider,
  state,
  health,
  className,
}: WarRoomProviderHeaderProps) {
  const meta =
    provider === 'SLACK' ? PROVIDER_PRESENTATION.SLACK : PROVIDER_PRESENTATION.MICROSOFT_TEAMS;
  const isSlack = provider === 'SLACK';

  return (
    <div className={`flex items-center justify-between gap-2 ${className || ''}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-2xs border shrink-0 ${
            isSlack
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50 text-amber-600 dark:text-amber-400'
              : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400'
          }`}
        >
          {isSlack ? (
            <SlackLogo className="h-4.5 w-4.5" />
          ) : (
            <MicrosoftTeamsLogo className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs truncate block">
            {meta.displayName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {state && <WarRoomLifecycleBadge state={state} />}
        {health && health !== 'HEALTHY' && <WarRoomHealthBadge health={health} />}
      </div>
    </div>
  );
}
