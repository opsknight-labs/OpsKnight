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
import { WarRoomCreateDialog } from './WarRoomCreateDialog';
import { WarRoomHistory } from './WarRoomHistory';
import type {
  IncidentCollaborationView,
  WarRoomProviderName,
} from '@/lib/incident-collaboration/types';

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
          className={
            presentation === 'mobile'
              ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl p-4 sm:p-6'
              : 'sm:max-w-md w-full overflow-y-auto p-6'
          }
        >
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-lg font-bold flex items-center gap-2">
              <Users className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
              <span>Incident Collaboration</span>
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Real-time war rooms and ChatOps channels for incident responders.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pt-4">
            {/* Active War Rooms */}
            {activeProviders.length > 0 ? (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Active War Rooms ({activeProviders.length})
                  </h3>
                  {canCreateAny && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCreateDialog(true)}
                      className="h-8 text-xs font-medium gap-1 px-2.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add room</span>
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
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
              <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-3 bg-muted/20">
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
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={onCreate}
        isPending={isCreatePending}
      />
    </>
  );
}
