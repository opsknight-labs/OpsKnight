interface HeatStripDatum {
  key: string;
  label: string;
  count: number;
}

interface HeatStripProps {
  data: HeatStripDatum[];
  maxValue: number;
  height?: number;
  /** Accessible name of the whole strip, for example "Pages per day for Ana". */
  label?: string;
}

function getCellColor(intensity: number) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const alpha = 0.12 + clamped * 0.7;
  return `rgba(59, 130, 246, ${alpha.toFixed(2)})`;
}

/**
 * One row of day cells shaded by count. Self-contained (Tailwind only), so it renders the same on any page,
 * in light and dark mode. Server-renderable: no client JavaScript.
 */
export default function HeatStrip({ data, maxValue, height = 24, label }: HeatStripProps) {
  if (!data.length) {
    return (
      <div
        className="analytics-heat-strip-empty flex items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
        style={{ height: `${height}px` }}
      >
        No data
      </div>
    );
  }

  const safeMax = Math.max(1, maxValue);
  const startLabel = data[0]?.label ?? '';
  const endLabel = data[data.length - 1]?.label ?? '';
  const total = data.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="analytics-heat-strip flex flex-col gap-2">
      <div
        className="analytics-heat-strip-row grid items-stretch gap-1 rounded-lg border border-border/70 bg-muted/40 p-1.5"
        style={{
          height: `${height}px`,
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
        }}
        role="img"
        aria-label={`${label ?? 'Daily counts'}: ${total} from ${startLabel} to ${endLabel}`}
      >
        {data.map(entry => (
          <span
            key={entry.key}
            className="analytics-heat-strip-cell block h-full rounded-sm ring-1 ring-inset ring-border/40"
            style={{ backgroundColor: getCellColor(entry.count / safeMax) }}
            title={`${entry.label}: ${entry.count}`}
          />
        ))}
      </div>
      <div className="analytics-heat-strip-axis flex justify-between text-2xs uppercase tracking-wider text-muted-foreground">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
