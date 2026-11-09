import Link from 'next/link';
import { BellOff, Copy, Layers, Wrench } from 'lucide-react';
import type { IncidentListBadge } from '@/lib/intelligence/incident-ux/list-badges';

const chip =
  'inline-flex max-w-[16rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold';
const linkChip = `${chip} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;

/**
 * Intelligence badges on one incident list row. Pure and presentational (works in the client list):
 * grouped (with parent link), parent of N, suppressed by <rule>, in maintenance, similar to #<n>.
 * Colours are status tokens with a text label, never colour alone.
 */
export default function IncidentListBadges({ badges }: { badges?: IncidentListBadge[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="contents" data-testid="incident-intelligence-badges">
      {badges.map((badge, index) => {
        switch (badge.kind) {
          case 'grouped':
            return badge.parentId ? (
              <Link
                key={index}
                href={`/incidents/${badge.parentId}`}
                data-no-row-nav="true"
                className={`${linkChip} border-status-shift/40 bg-status-shift/10 text-status-shift-deep dark:text-foreground`}
                aria-label={`Grouped under parent incident ${badge.parentRef}`}
              >
                <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
                Grouped → {badge.parentRef}
              </Link>
            ) : (
              <span
                key={index}
                className={`${chip} border-status-shift/40 bg-status-shift/10 text-status-shift-deep dark:text-foreground`}
              >
                <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
                Grouped
              </span>
            );
          case 'parent':
            return (
              <span
                key={index}
                className={`${chip} border-status-shift/40 bg-status-shift/10 text-status-shift-deep dark:text-foreground`}
              >
                <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
                {badge.count} grouped
              </span>
            );
          case 'suppressed':
            return (
              <span
                key={index}
                title={badge.label}
                className={`${chip} border-border bg-muted text-muted-foreground`}
              >
                <BellOff className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{badge.label}</span>
              </span>
            );
          case 'maintenance':
            return (
              <span
                key={index}
                title={badge.label}
                className={`${chip} border-status-info/40 bg-status-info/10 text-status-info-deep dark:text-foreground`}
              >
                <Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{badge.label}</span>
              </span>
            );
          case 'similar':
            return (
              <Link
                key={index}
                href={`/incidents/${badge.incidentId}`}
                data-no-row-nav="true"
                className={`${linkChip} border-border bg-background text-foreground`}
                aria-label={`Similar to incident ${badge.ref}, ${badge.confidencePercent}% confidence`}
              >
                <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
                Similar to {badge.ref}
              </Link>
            );
        }
      })}
    </span>
  );
}
