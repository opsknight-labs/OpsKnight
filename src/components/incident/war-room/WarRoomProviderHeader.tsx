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
  const meta = PROVIDER_PRESENTATION[provider];

  return (
    <div className={`flex items-center justify-between gap-2 ${className || ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="shrink-0">
          {provider === 'SLACK' ? (
            <SlackLogo className="h-5 w-5" />
          ) : (
            <MicrosoftTeamsLogo className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0">
          <span className="font-semibold text-foreground text-sm truncate block">
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
