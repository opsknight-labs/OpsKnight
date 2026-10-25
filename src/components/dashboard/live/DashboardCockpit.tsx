'use client';

import type { ReactNode } from 'react';
import { useViewportFill } from '@/hooks/useViewportFill';

/**
 * Above-the-fold operations area. On desktop it is sized to exactly the visible viewport so the
 * entire Live Incidents panel (header, list and footer) and the responder rail are on screen
 * without scrolling the page; their contents scroll internally. Phones/tablets stack naturally.
 */
export default function DashboardCockpit({ feed, rail }: { feed: ReactNode; rail: ReactNode }) {
  const { ref, height } = useViewportFill<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-testid="dashboard-cockpit"
      className="grid grid-cols-1 gap-4 xl:h-[calc(100dvh-17rem)] xl:min-h-[22.5rem] xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_23rem]"
      style={height ? { height } : undefined}
    >
      <div className="min-h-0 min-w-0">{feed}</div>
      <aside
        aria-label="Responder overview"
        data-testid="responder-rail"
        className="grid min-h-0 min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:flex xl:flex-col xl:gap-3"
      >
        {rail}
      </aside>
    </div>
  );
}
