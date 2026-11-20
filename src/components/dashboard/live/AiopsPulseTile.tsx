import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { AiopsPulse } from '@/lib/intelligence/surfaces/dashboard-pulse';

const format = (value: number, cap = 999) =>
  value > cap ? `${cap}+` : new Intl.NumberFormat('en-US').format(value);

/**
 * "AIOps pulse" row of the Ops Pulse panel: pages avoided, open groups, triage suggestions awaiting
 * review and (administrators only) quarantined work. Only non-zero numbers are listed, and the server
 * passes no pulse at all when every number is zero, so this never renders an empty tile. The whole tile
 * is one link to the AIOps overview, where each number has its own section.
 */
export default function AiopsPulseTile({ pulse }: { pulse: AiopsPulse | null }) {
  if (!pulse) return null;
  const stats = [
    { key: 'pages', label: `Pages avoided · ${pulse.windowHours} h`, value: pulse.pagesAvoided },
    { key: 'groups', label: 'Open groups', value: pulse.openGroups },
    { key: 'triage', label: 'Triage to review', value: pulse.triageAwaitingReview },
    { key: 'quarantined', label: 'Quarantined work', value: pulse.quarantinedWork ?? 0 },
  ].filter(stat => stat.value > 0);
  if (stats.length === 0) return null;
  return (
    <section className="px-4 py-3" data-testid="pulse-aiops" aria-labelledby="pulse-aiops-heading">
      <Link
        href="/intelligence"
        aria-label="AIOps pulse: open the AIOps overview"
        className="block rounded-xl border border-border/70 bg-muted/20 p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-status-shift/15 text-status-shift"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h3 id="pulse-aiops-heading" className="text-xs font-semibold text-foreground">
            AIOps pulse
          </h3>
          <span className="ml-auto text-xs font-semibold text-primary">Overview →</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {stats.map(stat => (
            <div key={stat.key} className="min-w-0" data-pulse-stat={stat.key}>
              <dt className="truncate text-2xs font-medium text-muted-foreground">{stat.label}</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">
                {format(stat.value)}
              </dd>
            </div>
          ))}
        </dl>
      </Link>
    </section>
  );
}
