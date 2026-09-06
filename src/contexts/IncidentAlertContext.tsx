'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useRealtime, type RealtimeIncident } from '@/hooks/useRealtime';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { notify } from '@/lib/toast';

export type CriticalIncidentSummary = {
  id: string;
  title: string;
  status: string;
  urgency?: string | null;
  priority?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
  acknowledgedAt?: string | Date | null;
  service?: {
    id?: string;
    name: string;
  } | null;
  assignee?: {
    id?: string;
    name?: string | null;
  } | null;
};

export interface IncidentAlertContextValue {
  activeCriticalIncidents: CriticalIncidentSummary[];
  currentIncident: CriticalIncidentSummary | null;
  currentIndex: number;
  totalCount: number;
  isBannerVisible: boolean;
  isSnoozed: boolean;
  nextIncident: () => void;
  prevIncident: () => void;
  selectIncident: (id: string) => void;
  snoozeBanner: () => void;
  dismissIncident: (id: string) => void;
  acknowledgeIncident: (id: string) => Promise<void>;
  isAcknowledging: boolean;
}

const IncidentAlertContext = createContext<IncidentAlertContextValue | null>(null);

const SNOOZE_STORAGE_KEY = 'opsknight:snoozed_critical_incidents';

function isCriticalIncident(item: {
  status?: unknown;
  priority?: unknown;
  urgency?: unknown;
}): boolean {
  const status = typeof item.status === 'string' ? item.status : '';
  if (status === 'RESOLVED' || status === 'SUPPRESSED') return false;

  const priority = typeof item.priority === 'string' ? item.priority.toUpperCase() : null;
  const urgency = typeof item.urgency === 'string' ? item.urgency.toUpperCase() : null;

  return priority === 'P1' || priority === 'P2' || urgency === 'HIGH';
}

function parseIncidentFromRecord(record: RealtimeIncident): CriticalIncidentSummary | null {
  const id = typeof record.id === 'string' ? record.id : null;
  const title = typeof record.title === 'string' ? record.title : null;
  if (!id || !title) return null;

  const serviceRaw = record.service as { id?: string; name?: string } | undefined;
  const assigneeRaw = record.assignee as { id?: string; name?: string } | undefined;

  return {
    id,
    title,
    status: typeof record.status === 'string' ? record.status : 'OPEN',
    urgency: typeof record.urgency === 'string' ? record.urgency : null,
    priority: typeof record.priority === 'string' ? record.priority : null,
    createdAt: (record.createdAt as string | Date) || new Date().toISOString(),
    updatedAt: (record.updatedAt as string | Date) || null,
    acknowledgedAt: (record.acknowledgedAt as string | Date) || null,
    service: serviceRaw?.name ? { id: serviceRaw.id, name: serviceRaw.name } : null,
    assignee: assigneeRaw?.id ? { id: assigneeRaw.id, name: assigneeRaw.name ?? null } : null,
  };
}

export function IncidentAlertProvider({
  children,
  initialIncidents = [],
}: {
  children: ReactNode;
  initialIncidents?: CriticalIncidentSummary[];
}) {
  const pathname = usePathname() || '';
  const { recentIncidents } = useRealtime();

  const [incidentsMap, setIncidentsMap] = useState<Map<string, CriticalIncidentSummary>>(() => {
    const map = new Map<string, CriticalIncidentSummary>();
    initialIncidents.forEach(inc => {
      if (isCriticalIncident(inc)) {
        map.set(inc.id, inc);
      }
    });
    return map;
  });

  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = sessionStorage.getItem(SNOOZE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch {
      // Ignore storage read error
    }
    return new Set();
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  // Connection timestamp guard: only fire toast for incidents created AFTER client mount
  const mountTimestampRef = useRef<number>(Date.now());
  const toastedIdsRef = useRef<Set<string>>(new Set());

  // Keep sessionStorage in sync
  const updateSnoozedIds = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setSnoozedIds(prev => {
      const next = updater(prev);
      try {
        sessionStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore storage write error
      }
      return next;
    });
  }, []);

  const acknowledgeIncident = useCallback(
    async (id: string) => {
      setIsAcknowledging(true);
      try {
        await updateIncidentStatus(id, 'ACKNOWLEDGED');
        setIncidentsMap(prev => {
          const next = new Map(prev);
          const inc = next.get(id);
          if (inc) {
            next.set(id, {
              ...inc,
              status: 'ACKNOWLEDGED',
              acknowledgedAt: new Date().toISOString(),
            });
          }
          return next;
        });
        notify.success('Incident acknowledged');
      } catch (err) {
        notify.error(err, { description: 'Failed to acknowledge incident' });
      } finally {
        setIsAcknowledging(false);
      }
    },
    []
  );

  // Sync with real-time SSE stream updates
  useEffect(() => {
    if (!recentIncidents || recentIncidents.length === 0) return;

    setIncidentsMap(prev => {
      let changed = false;
      const next = new Map(prev);

      for (const item of recentIncidents) {
        const parsed = parseIncidentFromRecord(item);
        if (!parsed) continue;

        const isCritical = isCriticalIncident(parsed);
        const existing = next.get(parsed.id);

        if (parsed.status === 'RESOLVED' || !isCritical) {
          if (next.has(parsed.id)) {
            next.delete(parsed.id);
            changed = true;
          }
        } else {
          // If status, priority, or title changed, or new critical incident
          if (!existing || JSON.stringify(existing) !== JSON.stringify(parsed)) {
            next.set(parsed.id, parsed);
            changed = true;

            // If an incident escalates (e.g. from P2 to P1 or reopens), un-snooze it
            if (existing && existing.priority !== 'P1' && parsed.priority === 'P1') {
              updateSnoozedIds(snoozeSet => {
                const nextSet = new Set(snoozeSet);
                nextSet.delete(parsed.id);
                return nextSet;
              });
            }
          }
        }

        // Check if this is a genuine brand-new incident created while connected
        const createdTime = new Date(parsed.createdAt).getTime();
        const isNewArrival =
          createdTime >= mountTimestampRef.current - 5000 &&
          !toastedIdsRef.current.has(parsed.id) &&
          isCritical &&
          parsed.status !== 'RESOLVED';

        if (isNewArrival) {
          toastedIdsRef.current.add(parsed.id);
          notify.incident(
            {
              id: parsed.id,
              title: parsed.title,
              priority: parsed.priority,
              urgency: parsed.urgency,
              service: parsed.service,
              createdAt: parsed.createdAt,
            },
            {
              onAcknowledge: async (id: string) => {
                await acknowledgeIncident(id);
              },
            }
          );
        }
      }

      return changed ? next : prev;
    });
  }, [recentIncidents, updateSnoozedIds, acknowledgeIncident]);

  // Derive visible active critical incidents, sorted by priority (P1 first) and recency
  const activeCriticalIncidents = useMemo(() => {
    return Array.from(incidentsMap.values()).sort((a, b) => {
      const pA = a.priority === 'P1' ? 1 : a.priority === 'P2' ? 2 : 3;
      const pB = b.priority === 'P1' ? 1 : b.priority === 'P2' ? 2 : 3;
      if (pA !== pB) return pA - pB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [incidentsMap]);

  // Context-aware suppression: check if currently viewing an incident's detail page
  const viewingIncidentIdMatch = /^\/incidents\/([^/?#]+)/.exec(pathname);
  const viewingIncidentId = viewingIncidentIdMatch?.at(1) ?? null;

  // Filter out snoozed and contextually suppressed incidents
  const displayableIncidents = useMemo(() => {
    return activeCriticalIncidents.filter(inc => {
      if (snoozedIds.has(inc.id)) return false;
      if (viewingIncidentId && inc.id === viewingIncidentId) return false;
      return true;
    });
  }, [activeCriticalIncidents, snoozedIds, viewingIncidentId]);

  const totalCount = displayableIncidents.length;
  const clampedIndex = totalCount > 0 ? Math.min(selectedIndex, totalCount - 1) : 0;
  const currentIncident = totalCount > 0 ? (displayableIncidents.at(clampedIndex) ?? null) : null;

  const nextIncident = useCallback(() => {
    if (totalCount <= 1) return;
    setSelectedIndex(prev => (prev + 1) % totalCount);
  }, [totalCount]);

  const prevIncident = useCallback(() => {
    if (totalCount <= 1) return;
    setSelectedIndex(prev => (prev - 1 + totalCount) % totalCount);
  }, [totalCount]);

  const selectIncident = useCallback(
    (id: string) => {
      const idx = displayableIncidents.findIndex(inc => inc.id === id);
      if (idx !== -1) setSelectedIndex(idx);
    },
    [displayableIncidents]
  );

  const snoozeBanner = useCallback(() => {
    if (!currentIncident) return;
    updateSnoozedIds(prev => new Set(prev).add(currentIncident.id));
  }, [currentIncident, updateSnoozedIds]);

  const dismissIncident = useCallback(
    (id: string) => {
      updateSnoozedIds(prev => new Set(prev).add(id));
    },
    [updateSnoozedIds]
  );

  const isBannerVisible = totalCount > 0;
  const isSnoozed = activeCriticalIncidents.length > 0 && totalCount === 0;

  const value = useMemo<IncidentAlertContextValue>(
    () => ({
      activeCriticalIncidents,
      currentIncident,
      currentIndex: clampedIndex,
      totalCount,
      isBannerVisible,
      isSnoozed,
      nextIncident,
      prevIncident,
      selectIncident,
      snoozeBanner,
      dismissIncident,
      acknowledgeIncident,
      isAcknowledging,
    }),
    [
      activeCriticalIncidents,
      currentIncident,
      clampedIndex,
      totalCount,
      isBannerVisible,
      isSnoozed,
      nextIncident,
      prevIncident,
      selectIncident,
      snoozeBanner,
      dismissIncident,
      acknowledgeIncident,
      isAcknowledging,
    ]
  );

  return <IncidentAlertContext.Provider value={value}>{children}</IncidentAlertContext.Provider>;
}

export function useIncidentAlert(): IncidentAlertContextValue {
  const context = useContext(IncidentAlertContext);
  if (!context) {
    throw new Error('useIncidentAlert must be used within an IncidentAlertProvider');
  }
  return context;
}
