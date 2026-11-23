import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { GRAPH_STATUS_META } from './GraphHealthBadge';

const STATUSES = [
  GRAPH_STATUS_META.OPERATIONAL,
  GRAPH_STATUS_META.DEGRADED,
  GRAPH_STATUS_META.MAJOR_OUTAGE,
  GRAPH_STATUS_META.MAINTENANCE,
];

function Line({ dash }: { dash?: string }) {
  return (
    <svg width="28" height="8" aria-hidden="true" className="text-muted-foreground">
      <line
        x1="0"
        y1="4"
        x2="28"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={dash}
      />
    </svg>
  );
}

/** What the shapes, lines and colours on the canvas mean. */
export default function GraphLegend({ grouped, canEdit }: { grouped: boolean; canEdit: boolean }) {
  const item = 'inline-flex items-center gap-1.5';
  return (
    <section
      aria-label="Legend"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-2 text-xs text-muted-foreground"
    >
      <span className={item}>
        <span
          className="h-3 w-5 rounded-sm border border-l-4 border-l-ink-400 bg-card"
          aria-hidden="true"
        />
        Business service
      </span>
      <span className={item}>
        <span
          className="h-3 w-5 rounded-md border border-l-4 border-l-ink-400 bg-card"
          aria-hidden="true"
        />
        Technical service
      </span>
      <span className={item}>
        <Line /> Depends on (arrow points to the dependency)
      </span>
      <span className={item}>
        <Line dash="2 3" /> Member
      </span>
      <span className={item}>
        <Line dash="6 4" /> Suggested
      </span>
      {STATUSES.map(meta => (
        <span key={meta.label} className={item}>
          <span
            className={cn('h-2.5 w-2.5 rounded-full', toneClasses(meta.tone).solid)}
            aria-hidden="true"
          />
          {meta.label}
        </span>
      ))}
      {grouped && <span>Grouped by team</span>}
      {canEdit && (
        <span>Drag from a service’s right handle to another service to add a dependency.</span>
      )}
    </section>
  );
}
