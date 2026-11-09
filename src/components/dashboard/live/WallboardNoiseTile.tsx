import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { WallboardNoiseTile as TileData } from '@/lib/intelligence/incident-ux/wallboard-noise';

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-xl font-semibold tabular-nums text-foreground">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/**
 * Wallboard tile with the last 24 hours of pre-paging noise KPIs (Workstream C): pages avoided, alert
 * compression, grouping and how often grouping was wrong. When noise controls are off it says so, and only
 * an administrator is told where to turn them on.
 */
export default function WallboardNoiseTile({ tile }: { tile: TileData }) {
  return (
    <section
      aria-labelledby="wallboard-noise-heading"
      data-testid="wallboard-noise-tile"
      className="rounded-xl border border-border bg-card p-3.5 text-card-foreground"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-status-shift/15 text-status-shift">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <h2 id="wallboard-noise-heading" className="text-sm font-semibold">
          Noise reduction
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">last 24 h</span>
      </div>
      {tile.state === 'off' ? (
        <p className="text-xs text-muted-foreground">
          Noise controls are off.{' '}
          {tile.canManage && (
            <>
              Turn them on in{' '}
              <Link
                href="/settings/intelligence/noise-controls"
                className="underline underline-offset-2"
              >
                Intelligence › Noise controls
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2" aria-live="polite">
          <Stat
            label={tile.shadowOnly ? 'Would avoid (shadow)' : 'Pages avoided'}
            value={formatNumber(tile.shadowOnly ? tile.shadowWouldAvoid : tile.pagesAvoided)}
            hint={
              !tile.shadowOnly && tile.shadowWouldAvoid > 0
                ? `+${formatNumber(tile.shadowWouldAvoid)} in shadow`
                : undefined
            }
          />
          <Stat label="Alerts per incident" value={`${tile.compressionRatio}×`} />
          <Stat
            label="Grouped"
            value={formatNumber(tile.grouped)}
            hint={tile.grouped > 0 ? `${tile.falseGroupPercent}% ungrouped` : undefined}
          />
          <Stat label="Heartbeats missing" value={formatNumber(tile.heartbeatsMissing)} />
        </dl>
      )}
    </section>
  );
}
