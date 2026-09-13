'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SwipeableIncidentCard from '@/components/mobile/SwipeableIncidentCard';
import { logger } from '@/lib/logger';
import { readCache, writeCache } from '@/lib/mobile-cache';
import {
  IncidentStatusMutationError,
  mutateIncidentStatus,
  type BrowserIncidentStatus,
} from '@/lib/incidents/status-client';

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
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadFromCache = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<IncidentListItem[]>('mobile-incidents', 24 * 60 * 60 * 1000);
        if (cached && Array.isArray(cached) && cached.length > 0) setLocalIncidents(cached);
      }
    };
    void loadFromCache();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (incidents.length === 0 && !navigator.onLine) return;
    setLocalIncidents(incidents);
    void writeCache('mobile-incidents', incidents);
  }, [incidents]);

  useEffect(() => {
    void writeCache('mobile-incidents', localIncidents);
  }, [localIncidents]);

  const handleStatusUpdate = async (id: string, status: 'ACKNOWLEDGED' | 'SNOOZED') => {
    if (updatingId) return;
    setUpdatingId(id);
    setErrorMessage('');

    const previous = localIncidents;
    const expectedStatus = localIncidents.find(incident => incident.id === id)?.status;

    setLocalIncidents(current => {
      const updated = current.map(incident =>
        incident.id === id ? { ...incident, status } : incident
      );
      if (filter === 'open') return updated.filter(incident => incident.id !== id);
      if (filter === 'all_open' && status !== 'ACKNOWLEDGED') {
        return updated.filter(incident => incident.id !== id);
      }
      if (filter === 'acknowledged' && status !== 'ACKNOWLEDGED') {
        return updated.filter(incident => incident.id !== id);
      }
      if (filter === 'muted' && status !== 'SNOOZED') {
        return updated.filter(incident => incident.id !== id);
      }
      return updated;
    });

    try {
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
      setUpdatingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {errorMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
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
          isUpdating={updatingId === incident.id}
        />
      ))}
    </div>
  );
}
