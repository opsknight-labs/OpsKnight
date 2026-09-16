'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Plus, AlertTriangle, Users } from 'lucide-react';
import { IncidentWarRoomManager } from './IncidentWarRoomManager';
import { useIncidentWarRooms } from './useIncidentWarRooms';
import type {
  IncidentCollaborationView,
  WarRoomProviderName,
} from '@/lib/incident-collaboration/types';
import { cn } from '@/lib/utils';

type WarRoomLauncherProps = {
  collaboration: IncidentCollaborationView;
  presentation?: 'desktop' | 'mobile';
  className?: string;
  onAction?: (action: string, roomId: string) => Promise<void> | void;
  onCreate?: (
    provider: WarRoomProviderName,
    options?: { membershipType?: 'STANDARD' | 'PRIVATE' }
  ) => Promise<void> | void;
  pendingAction?: { roomId?: string; action: string } | null;
  isCreatePending?: boolean;
};

export function WarRoomLauncher({
  collaboration: initialCollaboration,
  presentation = 'desktop',
  className,
  onAction: externalOnAction,
  onCreate: externalOnCreate,
  pendingAction: externalPendingAction,
  isCreatePending: externalIsCreatePending,
}: WarRoomLauncherProps) {
  const [managerOpen, setManagerOpen] = useState(false);

  // Hook for adaptive polling, optimistic updates, and neutral actions
  const {
    collaboration,
    pendingAction: hookPendingAction,
    handleCreate: hookCreate,
    handleAction: hookAction,
  } = useIncidentWarRooms(initialCollaboration);

  const effectiveOnAction = externalOnAction || hookAction;
  const effectiveOnCreate = externalOnCreate || hookCreate;
  const effectivePendingAction =
    externalPendingAction ||
    (hookPendingAction
      ? {
          roomId: hookPendingAction.roomId,
          action: hookPendingAction.action,
        }
      : null);
  const effectiveIsCreatePending =
    externalIsCreatePending !== undefined
      ? externalIsCreatePending
      : hookPendingAction?.action === 'CREATE';

  // If collaboration is not visible (no providers configured and no rooms exist), render nothing!
  if (!collaboration || !collaboration.visible) {
    return null;
  }

  const { activeRooms, attentionRequired } = collaboration.summary;
  const activeProviders = collaboration.providers.filter(p => Boolean(p.currentRoom));
  const canCreateAny = collaboration.providers.some(p => p.canCreate);

  // Contextual launcher content
  const renderContent = () => {
    // 1. Multiple active rooms
    if (activeRooms > 1) {
      return (
        <div className="flex items-center gap-1.5">
          <div className="flex items-center -space-x-1 shrink-0">
            {activeProviders.map(p => (
              <span key={p.provider} className="inline-block">
                {p.provider === 'SLACK' ? (
                  <SlackLogo className="h-4 w-4" />
                ) : (
                  <MicrosoftTeamsLogo className="h-4.5 w-4.5" />
                )}
              </span>
            ))}
          </div>
          <span className="font-semibold">War rooms · {activeRooms}</span>
          {attentionRequired > 0 && (
            <AlertTriangle
              className="h-3.5 w-3.5 text-amber-500 shrink-0"
              aria-label="Attention required"
            />
          )}
        </div>
      );
    }

    // 2. Exactly one active room
    if (activeRooms === 1 && activeProviders.length === 1) {
      const p = activeProviders[0];
      return (
        <div className="flex items-center gap-1.5">
          {p.provider === 'SLACK' ? (
            <SlackLogo className="h-4 w-4 shrink-0" />
          ) : (
            <MicrosoftTeamsLogo className="h-4.5 w-4.5 shrink-0" />
          )}
          <span className="font-semibold">War room</span>
          {attentionRequired > 0 && (
            <AlertTriangle
              className="h-3.5 w-3.5 text-amber-500 shrink-0"
              aria-label="Attention required"
            />
          )}
        </div>
      );
    }

    // 3. No active rooms, but create capability exists
    if (canCreateAny) {
      return (
        <div className="flex items-center gap-1.5">
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>Create war room</span>
        </div>
      );
    }

    // 4. Historical rooms exist, but no active room and cannot create
    if (collaboration.history.length > 0) {
      return (
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>War rooms</span>
        </div>
      );
    }

    return null;
  };

  const content = renderContent();
  if (!content) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setManagerOpen(true)}
        className={cn(
          'h-9 text-xs font-medium gap-2 px-3 border-border hover:bg-accent/50 transition-colors',
          attentionRequired > 0 && 'border-amber-500/40 bg-amber-500/5',
          className
        )}
        aria-label="Open incident collaboration manager"
      >
        {content}
      </Button>

      <IncidentWarRoomManager
        collaboration={collaboration}
        open={managerOpen}
        onOpenChange={setManagerOpen}
        presentation={presentation}
        onAction={effectiveOnAction}
        onCreate={effectiveOnCreate}
        pendingAction={effectivePendingAction}
        isCreatePending={effectiveIsCreatePending}
      />
    </>
  );
}
