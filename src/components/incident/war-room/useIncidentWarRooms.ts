'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type {
  IncidentCollaborationView,
  WarRoomProviderName,
} from '@/lib/incident-collaboration/types';

export type PendingActionState = {
  roomId?: string;
  provider?: WarRoomProviderName;
  action: string;
} | null;

export function useIncidentWarRooms(initialCollaboration: IncidentCollaborationView) {
  const router = useRouter();
  const [collaboration, setCollaboration] =
    useState<IncidentCollaborationView>(initialCollaboration);
  const [pendingAction, setPendingAction] = useState<PendingActionState>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync state if initialCollaboration prop updates from server
  useEffect(() => {
    setCollaboration(initialCollaboration);
  }, [initialCollaboration]);

  // Determine if any room or meeting is in a transitional lifecycle state
  const hasTransitionalState =
    collaboration.providers.some(p => {
      const room = p.currentRoom;
      if (!room) return false;
      return ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'CLOSING'].includes(room.state);
    }) ||
    Boolean(
      collaboration.meeting && ['PROVISIONING', 'CLOSING'].includes(collaboration.meeting.state)
    );

  // Track elapsed polling duration to implement exponential/stepped backoff
  const pollStartRef = useRef<number | null>(null);

  const fetchLatestCollaboration = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${collaboration.incidentId}/collaboration`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.data) {
        setCollaboration(data.data);
      }
    } catch {
      // Network glitches during polling are silently swallowed; next tick will retry
    }
  }, [collaboration.incidentId]);

  // Adaptive polling effect
  useEffect(() => {
    if (!hasTransitionalState) {
      pollStartRef.current = null;
      return;
    }

    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }

    let timerId: NodeJS.Timeout;

    const scheduleNextPoll = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        // Paused while tab is inactive
        timerId = setTimeout(scheduleNextPoll, 4000);
        return;
      }

      const elapsed = Date.now() - (pollStartRef.current || Date.now());
      let intervalMs = 2000;
      if (elapsed > 60_000) {
        intervalMs = 10_000;
      } else if (elapsed > 15_000) {
        intervalMs = 4000;
      }

      timerId = setTimeout(async () => {
        await fetchLatestCollaboration();
        scheduleNextPoll();
      }, intervalMs);
    };

    scheduleNextPoll();

    return () => {
      clearTimeout(timerId);
    };
  }, [hasTransitionalState, fetchLatestCollaboration]);

  // Neutral Create Handler
  const handleCreate = useCallback(
    async (
      provider: WarRoomProviderName,
      options?: { membershipType?: 'STANDARD' | 'PRIVATE' }
    ) => {
      setError(null);
      setPendingAction({ provider, action: 'CREATE' });

      // Optimistically update provider state to PROVISIONING
      setCollaboration(prev => ({
        ...prev,
        providers: prev.providers.map(p => {
          if (p.provider !== provider) return p;
          return {
            ...p,
            canCreate: false,
            currentRoom: {
              id: `temp-${Date.now()}`,
              provider,
              generation: (p.history.length || 0) + 1,
              state: 'PROVISIONING',
              health: 'HEALTHY',
              channelId: null,
              channelName: 'Creating war room…',
              channelUrl: null,
              deepLinkUrl: null,
              membershipType: options?.membershipType || null,
              createdAt: new Date().toISOString(),
              readyAt: null,
              closedAt: null,
              archivedAt: null,
              lastError: null,
              lastErrorCode: null,
              lastReconciledAt: null,
              actions: {
                canOpen: false,
                canCreate: false,
                canClose: false,
                canReconcile: false,
                canSyncParticipants: false,
                canRefreshProjection: false,
                canRetryCleanup: false,
                canCreateReplacementProjection: false,
              },
              participants: {
                synced: 0,
                pending: 0,
                attentionRequired: 0,
                total: 0,
                items: [],
              },
            },
          };
        }),
      }));

      try {
        const res = await fetch(`/api/incidents/${collaboration.incidentId}/war-rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CREATE',
            provider,
            options,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.data?.success) {
          throw new Error(json.error?.message || 'Failed to create war room.');
        }

        pollStartRef.current = Date.now();
        await fetchLatestCollaboration();
        router.refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to create war room.';
        setError(msg);
        // Rollback optimistic update
        await fetchLatestCollaboration();
      } finally {
        setPendingAction(null);
      }
    },
    [collaboration.incidentId, fetchLatestCollaboration, router]
  );

  // Neutral Action Handler (CLOSE, REFRESH_PROJECTION, SYNC_PARTICIPANTS, RECONCILE)
  const handleAction = useCallback(
    async (action: string, roomId: string) => {
      setError(null);
      setPendingAction({ roomId, action });

      // Optimistic lifecycle update for CLOSE
      if (action === 'CLOSE') {
        setCollaboration(prev => ({
          ...prev,
          providers: prev.providers.map(p => {
            if (p.currentRoom?.id !== roomId) return p;
            return {
              ...p,
              currentRoom: {
                ...p.currentRoom,
                state: 'CLOSING',
                actions: {
                  ...p.currentRoom.actions,
                  canClose: false,
                },
              },
            };
          }),
        }));
      }

      try {
        const res = await fetch(`/api/incidents/${collaboration.incidentId}/war-rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            roomId,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.data?.success) {
          throw new Error(json.error?.message || `Failed to execute action ${action}.`);
        }

        if (action === 'CLOSE') {
          pollStartRef.current = Date.now();
        }

        await fetchLatestCollaboration();
        router.refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : `Failed to execute action ${action}.`;
        setError(msg);
        await fetchLatestCollaboration();
      } finally {
        setPendingAction(null);
      }
    },
    [collaboration.incidentId, fetchLatestCollaboration, router]
  );

  // Meeting Action Handler (PROVISION, RETRY, CLOSE)
  const handleMeetingAction = useCallback(
    async (action: 'PROVISION' | 'RETRY' | 'CLOSE') => {
      setError(null);
      setPendingAction({ action: `MEETING_${action}` });

      // Optimistic update
      if (action === 'PROVISION' || action === 'RETRY') {
        setCollaboration(prev => {
          if (!prev.meeting) return prev;
          return {
            ...prev,
            meeting: {
              ...prev.meeting,
              state: 'PROVISIONING',
            },
          };
        });
      } else if (action === 'CLOSE') {
        setCollaboration(prev => {
          if (!prev.meeting) return prev;
          return {
            ...prev,
            meeting: {
              ...prev.meeting,
              state: 'CLOSED',
              actions: {
                ...prev.meeting.actions,
                canClose: false,
                canJoin: false,
                canRetry: false,
                canProvision: false,
              },
            },
          };
        });
      }

      try {
        const res = await fetch(`/api/incidents/${collaboration.incidentId}/meeting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });

        const json = await res.json();
        if (!res.ok || !json.data?.success) {
          throw new Error(json.error?.message || `Failed to execute meeting action ${action}.`);
        }

        pollStartRef.current = Date.now();
        await fetchLatestCollaboration();
        router.refresh();
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : `Failed to execute meeting action ${action}.`;
        setError(msg);
        await fetchLatestCollaboration();
        throw err;
      } finally {
        setPendingAction(null);
      }
    },
    [collaboration.incidentId, fetchLatestCollaboration, router]
  );

  return {
    collaboration,
    pendingAction,
    error,
    handleCreate,
    handleAction,
    handleMeetingAction,
    refreshCollaboration: fetchLatestCollaboration,
  };
}
