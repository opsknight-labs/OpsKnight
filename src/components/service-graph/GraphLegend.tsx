import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { GRAPH_STATUS_META } from './GraphHealthBadge';
import { EDGE_STROKE, STATUS_HEX } from './model';

const STATUSES = [
  GRAPH_STATUS_META.OPERATIONAL,
  GRAPH_STATUS_META.DEGRADED,
  GRAPH_STATUS_META.PARTIAL_OUTAGE,
  GRAPH_STATUS_META.MAJOR_OUTAGE,
  GRAPH_STATUS_META.MAINTENANCE,
  GRAPH_STATUS_META.UNKNOWN,
];

function Line({ dash, color, width = 1.5 }: { dash?: string; color?: string; width?: number }) {
  return (
    <svg width="28" height="8" aria-hidden="true" className="shrink-0 text-muted-foreground">
      <line
        x1="0"
        y1="4"
        x2="28"
        y2="4"
        stroke={color ?? 'currentColor'}
        strokeWidth={width}
        strokeDasharray={dash}
      />
    </svg>
  );
}

const chip = 'shrink-0 rounded-sm border px-1 text-2xs font-semibold';

/** What the shapes, lines, labels and colours on the canvas mean. */
export default function GraphLegend({ grouped, canEdit }: { grouped: boolean; canEdit: boolean }) {
  const item = 'inline-flex items-center gap-1.5';
  const heading = 'col-span-full text-2xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <section
      aria-label="Legend"
      className="grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2"
    >
      <h3 className={heading}>Nodes</h3>
      <span className={item}>
        <span className="h-3 w-5 rounded-sm border border-l-4 border-l-ink-400 bg-card" aria-hidden="true" />
        Business service
      </span>
      <span className={item}>
        <span className="h-3 w-5 rounded-md border border-l-4 border-l-ink-400 bg-card" aria-hidden="true" />
        Technical service
      </span>
      <span className={item}>
        <span className={cn(chip, 'border-foreground bg-foreground text-background')}>Tier 0</span>
        Most critical tier, heavier frame
      </span>
      <span className={item}>
        <span className={cn(chip, toneClasses('critical').soft)}>SPOF</span>
        Single point of failure
      </span>
      <span className={item}>
        <span className={cn(chip, 'border-border bg-card text-foreground')}>2 hops</span>
        Distance from the selected service
      </span>
      <span className={item}>
        <span className={cn(chip, 'bg-muted text-muted-foreground')}>filtered</span>
        Hidden by filters, on the highlight
      </span>
      {STATUSES.map(meta => (
        <span key={meta.label} className={item}>
          <span className={cn('h-2.5 w-2.5 rounded-full', toneClasses(meta.tone).solid)} aria-hidden="true" />
          {meta.label}
        </span>
      ))}

      <h3 className={cn(heading, 'mt-1')}>Lines (arrow points to the dependency)</h3>
      <span className={item}>
        <Line /> Hard dependency
      </span>
      <span className={item}>
        <Line dash="10 3 2 3" /> Soft dependency
      </span>
      <span className={item}>
        <Line dash="6 4" /> Suggested
      </span>
      <span className={item}>
        <Line dash="2 3" width={1} /> Member service
      </span>
      <span className={item}>
        <Line dash="12 5" width={2} /> Supporting business service
      </span>
      <span className={item}>
        <Line color={EDGE_STROKE.traffic} width={3} /> Measured traffic (thicker = more)
      </span>
      <span className={item}>
        <span className={cn(chip, toneClasses('critical').soft)}>6% err</span>
        Error rate on that traffic
      </span>
      <span className={item}>
        <Line color={STATUS_HEX.MAJOR_OUTAGE} width={2.5} /> Highlighted path into an impacted service
      </span>
      <span className={item}>
        <Line color={EDGE_STROKE.added} width={2.5} />
        <span className={cn(chip, 'border-border bg-card text-foreground')}>new</span> /
        <Line color={EDGE_STROKE.removed} dash="3 4" width={2.5} />
        <span className={cn(chip, 'border-border bg-card text-foreground')}>removed</span>
        Changes
      </span>

      <p className="col-span-full mt-1 text-2xs">
        {grouped && 'Grouped by team; lines between teams are drawn as steps. '}
        {canEdit && 'Drag from a service’s right handle to another service to add a dependency. '}
        Statuses refresh every 30 seconds while this tab is open.
      </p>
    </section>
  );
}
