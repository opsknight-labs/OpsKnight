'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import SwipeableIncidentCard from '@/components/mobile/SwipeableIncidentCard';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import { logger } from '@/lib/logger';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import {
  IncidentStatusMutationError,
  mutateIncidentStatus,
  type BrowserIncidentStatus,
} from '@/lib/incidents/status-client';
import { snoozeIncidentWithDuration } from '@/app/(app)/incidents/snooze-actions';

// A swipe snooze is always finite so the auto-unsnooze worker resumes escalation.
const SWIPE_SNOOZE_MINUTES = 60;

type IncidentListItem = {
  id: string;
  title: string;
  status: BrowserIncidentStatus;
  urgency: string | null;
  createdAt: Date | string;
  service: { name: string };
};

export type IncidentFilter = 'all' | 'all_open' | 'muted' | 'open' | 'acknowledged' | 'resolved';

export default function MobileIncidentList({
  incidents,
  filter,
}: {
  incidents: IncidentListItem[];
  filter: IncidentFilter;
}) {
  const router = useRouter();
  const [localIncidents, setLocalIncidents] = useState<IncidentListItem[]>(incidents);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState('');
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const cacheKey = useMemo(() => {
    if (typeof window === 'undefined') return `mobile-incidents:${filter}`;
    const projection = new URLSearchParams(window.location.search);
    projection.sort();
    return `mobile-incidents:${projection.toString() || `filter=${filter}`}`;
  }, [filter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const reconcileConnectivity = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<IncidentListItem[]>(cacheKey, 24 * 60 * 60 * 1000);
        const status = readMobileCacheStatus(cacheKey);
        if (cancelled) return;
        if (cached && Array.isArray(cached)) {
          setLocalIncidents(cached);
          setCachedAt(status?.savedAt ?? null);
        }
      } else {
        setLocalIncidents(incidents);
        setCachedAt(null);
      }
    };
    window.addEventListener('online', reconcileConnectivity);
    window.addEventListener('offline', reconcileConnectivity);
    void reconcileConnectivity();
    return () => {
      cancelled = true;
      window.removeEventListener('online', reconcileConnectivity);
      window.removeEventListener('offline', reconcileConnectivity);
    };
  }, [cacheKey, incidents]);

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- online-only resync from props; navigator.onLine is browser state that cannot be read during render
    setLocalIncidents(incidents);
    setCachedAt(null);
    void writeCache(cacheKey, incidents);
  }, [cacheKey, incidents]);

  const handleStatusUpdate = async (id: string, status: 'ACKNOWLEDGED' | 'SNOOZED') => {
    if (updatingIds.has(id)) return;
    // A swipe is easy to trigger while scrolling; pausing escalation needs an explicit yes.
    if (
      status === 'SNOOZED' &&
      // eslint-disable-next-line no-alert -- blocking confirm keeps the swipe handler synchronous; an async dialog would need a pending-swipe state machine
      !window.confirm('Snooze this incident for 1 hour? Escalation pauses until then.')
    ) {
      return;
    }
    setUpdatingIds(current => new Set(current).add(id));
    setErrorMessage('');

    const previous = localIncidents;
    const expectedStatus = localIncidents.find(incident => incident.id === id)?.status;
    setLocalIncidents(current => {
      const updated = current.map(incident =>
        incident.id === id ? { ...incident, status } : incident
      );
      if (filter === 'open') return updated.filter(incident => incident.id !== id);
      if (filter === 'all_open' && status !== 'ACKNOWLEDGED')
        return updated.filter(incident => incident.id !== id);
      if (filter === 'acknowledged' && status !== 'ACKNOWLEDGED')
        return updated.filter(incident => incident.id !== id);
      if (filter === 'muted' && status !== 'SNOOZED')
        return updated.filter(incident => incident.id !== id);
      return updated;
    });

    try {
      if (status === 'SNOOZED') {
        await snoozeIncidentWithDuration(id, SWIPE_SNOOZE_MINUTES);
        router.refresh();
        return;
      }
      const result = await mutateIncidentStatus({ incidentId: id, status, expectedStatus });
      if (result.state === 'QUEUED') {
        setLocalIncidents(previous);
        setErrorMessage('Offline. Update queued and waiting for OpsKnight to confirm it.');
        return;
      }
      router.refresh();
    } catch (error: unknown) {
      setLocalIncidents(previous);
      const message =
        error instanceof IncidentStatusMutationError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to update incident';
      setErrorMessage(message);
      logger.error('mobile.incidentList.statusUpdateFailed', {
        component: 'MobileIncidentList',
        error,
        incidentId: id,
        status,
      });
    } finally {
      setUpdatingIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <MobileCachedDataNotice savedAt={cachedAt} />
      {errorMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {errorMessage}
        </div>
      ) : null}
      {localIncidents.map(incident => (
        <SwipeableIncidentCard
          key={incident.id}
          incident={incident}
          onAcknowledge={
            incident.status === 'OPEN'
              ? () => handleStatusUpdate(incident.id, 'ACKNOWLEDGED')
              : undefined
          }
          onSnooze={
            incident.status === 'OPEN'
              ? () => handleStatusUpdate(incident.id, 'SNOOZED')
              : undefined
          }
          isUpdating={updatingIds.has(incident.id)}
        />
      ))}
    </div>
  );
}
