'use client';

import type { ReactNode } from 'react';
import { useViewportFill } from '@/hooks/useViewportFill';
import { useLiveDashboard } from './LiveDashboardProvider';
import { IncidentInspector } from './IncidentInspector';
import { TableRowsSkeleton } from '@/components/patterns/Skeletons';

/**
 * Above-the-fold operations area. On desktop it is sized to exactly the visible viewport so the
 * entire Live Incidents panel (header, list and footer) and the responder rail / inspector are on screen
 * without scrolling the page; their contents scroll internally. Phones/tablets stack naturally.
 */
export default function DashboardCockpit({ feed, rail }: { feed: ReactNode; rail: ReactNode }) {
  const { ref, height } = useViewportFill<HTMLDivElement>();
  const {
    snapshot,
    loading,
    incidents,
    selectedIncidentId,
    selectedIncident: providerSelectedIncident,
    selectIncident,
    now,
    currentUserId,
    currentUserName,
    canAcknowledge,
    canAcknowledgeIncident,
    canAssignSelf,
    busyMap,
    acknowledgeIncident,
    assignIncidentToMe,
  } = useLiveDashboard();

  const selectedIncident =
    providerSelectedIncident ??
    (selectedIncidentId
      ? (incidents.find(i => i.id === selectedIncidentId) ??
        snapshot?.incidents.find(i => i.id === selectedIncidentId) ??
        null)
      : null);

  return (
    <div
      ref={ref}
      data-testid="dashboard-cockpit"
      className="grid grid-cols-1 gap-4 xl:h-[calc(100dvh-17rem)] xl:min-h-[22.5rem] xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_23rem]"
      style={height ? { height } : undefined}
    >
      <div className="min-h-0 min-w-0">{feed}</div>
      <aside
        aria-label={selectedIncident ? 'Incident inspector' : 'Responder overview'}
        data-testid="responder-rail"
        className="grid min-h-0 min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:flex xl:flex-col xl:gap-3"
      >
        {selectedIncident ? (
          <IncidentInspector
            incident={selectedIncident}
            now={now}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            canAcknowledge={canAcknowledge && canAcknowledgeIncident(selectedIncident)}
            canAssignSelf={canAssignSelf}
            busy={busyMap[selectedIncident.id] ?? null}
            onAcknowledge={acknowledgeIncident}
            onAssignSelf={assignIncidentToMe}
            onClose={() => selectIncident(null)}
          />
        ) : snapshot === null ? (
          // Without a snapshot the rail would read as "all clear"; show its real state instead.
          loading ? (
            <TableRowsSkeleton
              rows={5}
              columns={2}
              showHeader={false}
              label="Loading responder overview"
            />
          ) : (
            <section
              aria-label="Responder overview"
              className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground"
            >
              Queue, hotspots and on-call coverage appear once live data loads.
            </section>
          )
        ) : (
          rail
        )}
      </aside>
    </div>
  );
}
