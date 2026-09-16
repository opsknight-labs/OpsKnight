'use client';

import React, { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { Button } from '@/components/ui/shadcn/button';
import {
  MoreHorizontal,
  RefreshCw,
  Users,
  ShieldAlert,
  XCircle,
  Code,
  Loader2,
} from 'lucide-react';
import type { IncidentWarRoomView } from '@/lib/incident-collaboration/types';

type WarRoomActionsMenuProps = {
  room: IncidentWarRoomView;
  onAction: (action: string, roomId: string) => Promise<void> | void;
  pendingAction?: { roomId?: string; action: string } | null;
  onViewDiagnostics?: () => void;
};

export function WarRoomActionsMenu({
  room,
  onAction,
  pendingAction,
  onViewDiagnostics,
}: WarRoomActionsMenuProps) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const isRoomPending = pendingAction?.roomId === room.id;

  const handleConfirmClose = async () => {
    setShowCloseConfirm(false);
    await onAction('CLOSE', room.id);
  };

  const hasAnyActions =
    room.actions.canSyncParticipants ||
    room.actions.canRefreshProjection ||
    room.actions.canReconcile ||
    room.actions.canClose ||
    Boolean(onViewDiagnostics);

  if (!hasAnyActions) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Actions for ${room.channelName || room.provider} war room`}
            disabled={Boolean(isRoomPending)}
          >
            {isRoomPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {room.actions.canSyncParticipants && (
            <DropdownMenuItem
              onClick={() => onAction('SYNC_PARTICIPANTS', room.id)}
              disabled={isRoomPending && pendingAction?.action === 'SYNC_PARTICIPANTS'}
            >
              <Users className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
              <span>Sync responders</span>
            </DropdownMenuItem>
          )}

          {room.actions.canRefreshProjection && (
            <DropdownMenuItem
              onClick={() => onAction('REFRESH_PROJECTION', room.id)}
              disabled={isRoomPending && pendingAction?.action === 'REFRESH_PROJECTION'}
            >
              <RefreshCw className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
              <span>Refresh incident card</span>
            </DropdownMenuItem>
          )}

          {room.actions.canReconcile && (
            <DropdownMenuItem
              onClick={() => onAction('RECONCILE', room.id)}
              disabled={isRoomPending && pendingAction?.action === 'RECONCILE'}
            >
              <ShieldAlert className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
              <span>Reconcile room</span>
            </DropdownMenuItem>
          )}

          {onViewDiagnostics && (
            <DropdownMenuItem onClick={onViewDiagnostics}>
              <Code className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
              <span>View diagnostics</span>
            </DropdownMenuItem>
          )}

          {room.actions.canClose && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowCloseConfirm(true)}
                className="text-destructive focus:text-destructive"
                disabled={isRoomPending && pendingAction?.action === 'CLOSE'}
              >
                <XCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                <span>Close war room</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close war room?</AlertDialogTitle>
            <AlertDialogDescription>
              This will close active collaboration in{' '}
              <span className="font-semibold text-foreground">
                {room.channelName || `${room.provider} war room`}
              </span>
              . Responders will no longer be synced and the channel will be transitioned according
              to policy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmClose}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Close war room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
