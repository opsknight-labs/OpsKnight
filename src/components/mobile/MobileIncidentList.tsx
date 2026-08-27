'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SwipeableIncidentCard from '@/components/mobile/SwipeableIncidentCard';
import { logger } from '@/lib/logger';
import { enqueueRequest } from '@/lib/offline-queue';
import { readCache, writeCache } from '@/lib/mobile-cache';

type IncidentListItem = {
  id: string;
  title: string;
  status: string;
  urgency: string | null;
  createdAt: Date | string;
  service: { name: string };
};

type IncidentFilter = 'all' | 'open' | 'all_open' | 'resolved';

export default function MobileIncidentList({
  incidents,
  filter,
}: {
  incidents: IncidentListItem[];
  filter: IncidentFilter;
}) {
  const router = useRouter();
  const [localIncidents, setLocalIncidents] = useState<IncidentListItem[]>(incidents);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadFromCache = async () => {
      if (!navigator.onLine) {
        // Build treats this as async even if file looks sync locally
        const cached = await readCache<IncidentListItem[]>('mobile-incidents');
        if (cached && Array.isArray(cached) && cached.length > 0) {
          setLocalIncidents(cached);
        }
      }
    };
    void loadFromCache();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !navigator.onLine && incidents.length === 0) {
      return;
    }
    setLocalIncidents(incidents);
    writeCache('mobile-incidents', incidents);
  }, [incidents]);

  useEffect(() => {
    writeCache('mobile-incidents', localIncidents);
  }, [localIncidents]);

  const handleStatusUpdate = async (
    id: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED'
  ) => {
    if (updatingId) return;
    setUpdatingId(id);
    setErrorMessage('');
    const previous = localIncidents;
    const expectedStatus = localIncidents.find(incident => incident.id === id)?.status;
    setLocalIncidents(prev => {
      const updated = prev.map(incident =>
        incident.id === id ? { ...incident, status } : incident
      );
      if (filter === 'open' && status === 'RESOLVED') {
        return updated.filter(incident => incident.id !== id);
      }
      if (filter === 'resolved' && status !== 'RESOLVED') {
        return updated.filter(incident => incident.id !== id);
      }
      return updated;
    });
    const requestUrl =
      typeof window !== 'undefined'
        ? new URL(`/api/mobile/incidents/${id}/status`, window.location.origin).toString()
        : `/api/mobile/incidents/${id}/status`;
    try {
      const response = await fetch(requestUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, expectedStatus }),
      });
      if (!response.ok) {
        throw new Error('Failed to update incident');
      }
      router.refresh();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update incident';
      if (typeof window !== 'undefined' && !navigator.onLine) {
        try {
          await enqueueRequest({
            url: requestUrl,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, expectedStatus }),
          });
        } catch {
          // Ignore queue failures
        }
        setErrorMessage('Offline. Update queued and will sync automatically.');
      } else {
        setLocalIncidents(previous);
        setErrorMessage(message);
      }
      logger.error('mobile.incidentList.statusUpdateFailed', {
        component: 'MobileIncidentList',
        error,
        incidentId: id,
        status,
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {errorMessage}
        </div>
      )}
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
          onResolve={
            incident.status !== 'RESOLVED'
              ? () => handleStatusUpdate(incident.id, 'RESOLVED')
              : undefined
          }
          isUpdating={updatingId === incident.id}
        />
      ))}
    </div>
  );
}
