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
  isDismissed: boolean;
  nextIncident: () => void;
  prevIncident: () => void;
  selectIncident: (id: string) => void;
  dismissBanner: () => void;
  snoozeBanner: () => void;
  dismissIncident: (id: string) => void;
  acknowledgeIncident: (id: string) => Promise<void>;
  isAcknowledging: boolean;
}

const IncidentAlertContext = createContext<IncidentAlertContextValue | null>(null);

const DISMISSED_STORAGE_KEY = 'opsknight:banner_dismissed_at';
const SNOOZE_STORAGE_KEY = 'opsknight:snoozed_critical_incidents';
const RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  // Global banner dismissal timestamp in sessionStorage (persists across page navigation)
  const [dismissedAt, setDismissedAt] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem(DISMISSED_STORAGE_KEY);
      if (stored) {
        const val = Number(stored);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch {
      // Ignore storage read error
    }
    return null;
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  // Connection timestamp guard: only fire toast for incidents created AFTER client mount
  const mountTimestampRef = useRef<number>(Date.now());
  const toastedIdsRef = useRef<Set<string>>(new Set());

  const dismissBanner = useCallback(() => {
    const now = Date.now();
    setDismissedAt(now);
    try {
      sessionStorage.setItem(DISMISSED_STORAGE_KEY, String(now));
    } catch {
      // Ignore write error
    }
  }, []);

  const clearDismissal = useCallback(() => {
    setDismissedAt(null);
    try {
      sessionStorage.removeItem(DISMISSED_STORAGE_KEY);
    } catch {
      // Ignore write error
    }
  }, []);

  const acknowledgeIncident = useCallback(
    async (id: string) => {
      setIsAcknowledging(true);
      try {
        setIncidentsMap(prev => {
          const existing = prev.get(id);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(id, {
            ...existing,
            status: 'ACKNOWLEDGED',
            acknowledgedAt: new Date().toISOString(),
          });
          return next;
        });

        await updateIncidentStatus(id, 'ACKNOWLEDGED');
        notify.success('Incident acknowledged');
      } catch (err) {
        notify.error(err, { description: 'Failed to acknowledge incident' });
      } finally {
        setIsAcknowledging(false);
      }
    },
    []
  );

  // Sync with real-time SSE stream updates (push-based)
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

            // If an incident escalates (e.g. from P2 to P1 or reopens), re-open banner across all pages
            if (existing && existing.priority !== 'P1' && parsed.priority === 'P1') {
              clearDismissal();
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

          // A brand-new critical incident breaks any prior dismissal across all pages
          clearDismissal();

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
  }, [recentIncidents, clearDismissal, acknowledgeIncident]);

  // Derive visible active critical incidents scoped to the last 24h
  const activeCriticalIncidents = useMemo(() => {
    const now = Date.now();
    return Array.from(incidentsMap.values())
      .filter(inc => {
        const createdMs = new Date(inc.createdAt).getTime();
        return (
          !isNaN(createdMs) &&
          (now - createdMs <= RECENCY_THRESHOLD_MS || createdMs >= mountTimestampRef.current - 5000)
        );
      })
      .sort((a, b) => {
        // Open before Acknowledged
        if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
        if (b.status === 'OPEN' && a.status !== 'OPEN') return 1;
        // P1 before P2
        const pA = a.priority === 'P1' ? 1 : a.priority === 'P2' ? 2 : 3;
        const pB = b.priority === 'P1' ? 1 : b.priority === 'P2' ? 2 : 3;
        if (pA !== pB) return pA - pB;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [incidentsMap]);

  // Context-aware suppression: check if currently viewing an incident's detail page
  const viewingIncidentIdMatch = /^\/incidents\/([^/?#]+)/.exec(pathname);
  const viewingIncidentId = viewingIncidentIdMatch?.at(1) ?? null;

  // Filter out contextually suppressed incidents (when user is inside that incident's war room)
  const displayableIncidents = useMemo(() => {
    return activeCriticalIncidents.filter(inc => {
      if (viewingIncidentId && inc.id === viewingIncidentId) return false;
      return true;
    });
  }, [activeCriticalIncidents, viewingIncidentId]);

  // Once closed (dismissed), banner does NOT show on any page UNLESS a new P1/high incident occurs
  const hasNewIncidentAfterDismissal = useMemo(() => {
    if (!dismissedAt) return true;
    return displayableIncidents.some(inc => {
      const createdTime = new Date(inc.createdAt).getTime();
      return createdTime > dismissedAt;
    });
  }, [displayableIncidents, dismissedAt]);

  const isBannerVisible = displayableIncidents.length > 0 && hasNewIncidentAfterDismissal;
  const isDismissed = Boolean(dismissedAt && !hasNewIncidentAfterDismissal);

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

  const dismissIncident = useCallback(
    (_id: string) => {
      dismissBanner();
    },
    [dismissBanner]
  );

  const value = useMemo<IncidentAlertContextValue>(
    () => ({
      activeCriticalIncidents,
      currentIncident,
      currentIndex: clampedIndex,
      totalCount,
      isBannerVisible,
      isSnoozed: isDismissed,
      isDismissed,
      nextIncident,
      prevIncident,
      selectIncident,
      dismissBanner,
      snoozeBanner: dismissBanner, // alias for backwards compatibility
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
      isDismissed,
      nextIncident,
      prevIncident,
      selectIncident,
      dismissBanner,
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
