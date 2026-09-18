'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/shadcn/sheet';
import { Button } from '@/components/ui/shadcn/button';
import { Plus, Users } from 'lucide-react';
import { WarRoomProviderCard } from './WarRoomProviderCard';
import { IncidentMeetingCard } from './IncidentMeetingCard';
import { WarRoomCreateDialog } from './WarRoomCreateDialog';
import { WarRoomHistory } from './WarRoomHistory';
import type {
  IncidentCollaborationView,
  WarRoomProviderName,
} from '@/lib/incident-collaboration/types';
import { cn } from '@/lib/utils';

type IncidentWarRoomManagerProps = {
  collaboration: IncidentCollaborationView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation?: 'desktop' | 'mobile';
  onAction?: (action: string, roomId: string) => Promise<void> | void;
  onCreate?: (
    provider: WarRoomProviderName,
    options?: { membershipType?: 'STANDARD' | 'PRIVATE' }
  ) => Promise<void> | void;
  onMeetingAction?: (action: 'PROVISION' | 'RETRY' | 'CLOSE') => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
  pendingAction?: { roomId?: string; action: string } | null;
  isCreatePending?: boolean;
};

export function IncidentWarRoomManager({
  collaboration,
  open,
  onOpenChange,
  presentation = 'desktop',
  onAction = () => {},
  onCreate = () => {},
  onMeetingAction,
  onRefresh,
  pendingAction,
  isCreatePending,
}: IncidentWarRoomManagerProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Active rooms from all visible providers
  const activeProviders = collaboration.providers.filter(p => Boolean(p.currentRoom));
  const canCreateAny = collaboration.providers.some(p => p.canCreate);

  // Sheet side based on presentation
  const sheetSide = presentation === 'mobile' ? 'bottom' : 'right';

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={sheetSide}
          className={cn(
            'w-full sm:max-w-md flex flex-col p-0 bg-zinc-50 dark:bg-zinc-950 text-foreground border-l border-zinc-200 dark:border-zinc-800 shadow-2xl [&>button]:z-50 [&>button]:cursor-pointer [&>button]:text-zinc-400 [&>button]:hover:text-white [&>button]:top-4 [&>button]:right-4.5 [&>button]:rounded-md [&>button]:p-1.5 [&>button]:hover:bg-white/10 [&>button]:transition-colors overflow-hidden',
            presentation === 'mobile' && 'max-h-[85vh] rounded-t-2xl'
          )}
        >
          {/* Header styled identically to TopbarNotifications with gradient & sheen */}
          <div className="relative px-5 pt-4 pb-3 bg-gradient-to-b from-[#18181b] via-[#121216] to-[#09090b] text-white border-b border-zinc-800/80 shadow-2xs shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_60%)] pointer-events-none" />
            <SheetHeader className="p-0 space-y-0 text-left">
              <div className="flex items-center justify-between pr-12">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 border border-zinc-700/60 shadow-xs backdrop-blur-md shrink-0">
                    <Users className="h-4 w-4 text-white" aria-hidden="true" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <SheetTitle className="text-base font-bold tracking-tight text-white m-0 truncate">
                      Incident Collaboration
                    </SheetTitle>
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border leading-none shrink-0 text-emerald-400 bg-emerald-500/10 border-emerald-500/25">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Live
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative z-10 flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-zinc-800/50">
                <SheetDescription className="text-[11.5px] text-zinc-400 truncate m-0">
                  Real-time war rooms and ChatOps channels
                </SheetDescription>
                {canCreateAny && (
                  <button
                    type="button"
                    onClick={() => setShowCreateDialog(true)}
                    className="text-[11.5px] h-6 px-2 text-zinc-300 hover:text-white bg-zinc-800/90 hover:bg-zinc-700/90 border border-zinc-700/70 rounded-md font-medium inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0 shadow-2xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add room</span>
                  </button>
                )}
              </div>
            </SheetHeader>
          </div>

          {/* Grey background layer for cards */}
          <div className="flex-1 overflow-y-auto bg-zinc-50/70 dark:bg-zinc-950 p-3 sm:p-4 space-y-4">
            {/* Audio / Video War Room Bridge */}
            {collaboration.meeting && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 tracking-tight">
                    Audio / Video War Room Bridge
                  </h3>
                </div>
                <IncidentMeetingCard
                  meeting={collaboration.meeting}
                  onAction={async action => {
                    if (onMeetingAction) {
                      await onMeetingAction(action);
                      return;
                    }
                    const res = await fetch(`/api/incidents/${collaboration.incidentId}/meeting`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action }),
                    });
                    const json = await res.json();
                    if (!res.ok || !json.data?.success) {
                      throw new Error(
                        json.error?.message || `Failed to execute meeting action ${action}.`
                      );
                    }
                    if (onRefresh) {
                      await onRefresh();
                    }
                  }}
                />
              </div>
            )}

            {/* Active War Rooms */}
            {activeProviders.length > 0 ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 tracking-tight">
                    Active War Rooms ({activeProviders.length})
                  </h3>
                </div>

                <div className="space-y-2.5">
                  {activeProviders.map(providerView => (
                    <WarRoomProviderCard
                      key={providerView.provider}
                      providerView={providerView}
                      onAction={onAction}
                      pendingAction={pendingAction}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center space-y-3 bg-white/70 dark:bg-zinc-900/50">
                <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">No active war rooms</h4>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    Create a dedicated channel in Slack or Teams to coordinate responders in real
                    time.
                  </p>
                </div>
                {canCreateAny && (
                  <Button
                    size="sm"
                    onClick={() => setShowCreateDialog(true)}
                    className="min-h-9 font-medium px-4 mt-1"
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    <span>Create war room</span>
                  </Button>
                )}
              </div>
            )}

            {/* Historical Rooms */}
            {collaboration.history.length > 0 && <WarRoomHistory history={collaboration.history} />}
          </div>
        </SheetContent>
      </Sheet>

      <WarRoomCreateDialog
        providers={collaboration.providers}
        privacyRequirement={collaboration.privacyRequirement}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={onCreate}
        isPending={isCreatePending}
      />
    </>
  );
}
