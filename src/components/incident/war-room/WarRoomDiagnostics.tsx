'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import type { IncidentWarRoomView } from '@/lib/incident-collaboration/types';

type WarRoomDiagnosticsProps = {
  room: IncidentWarRoomView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WarRoomDiagnostics({ room, open, onOpenChange }: WarRoomDiagnosticsProps) {
  if (!room) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>War Room Diagnostics</DialogTitle>
          <DialogDescription>
            Internal identifiers, projection versions, and sync metadata for {room.provider}{' '}
            generation {room.generation}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs font-mono bg-muted/40 p-3 rounded-lg border border-border overflow-x-auto">
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Room ID:</span>
            <span className="select-all">{room.id}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Provider:</span>
            <span>{room.provider}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Generation:</span>
            <span>{room.generation}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Lifecycle State:</span>
            <span>{room.state}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Health:</span>
            <span>{room.health}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Channel ID:</span>
            <span className="select-all">{room.channelId || 'none'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground font-sans">Membership:</span>
            <span>{room.membershipType || 'STANDARD'}</span>
          </div>
          {room.lastErrorCode && (
            <div className="flex justify-between py-1 border-b border-border/50 text-destructive">
              <span className="font-sans">Last Error Code:</span>
              <span className="select-all">{room.lastErrorCode}</span>
            </div>
          )}
          {room.lastError && (
            <div className="py-1 text-destructive">
              <span className="text-muted-foreground font-sans block mb-1">Last Error:</span>
              <p className="whitespace-pre-wrap font-sans bg-background/80 p-2 rounded border border-border">
                {room.lastError}
              </p>
            </div>
          )}
          {room.lastReconciledAt && (
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground font-sans">Last Reconciled:</span>
              <span>{new Date(room.lastReconciledAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
