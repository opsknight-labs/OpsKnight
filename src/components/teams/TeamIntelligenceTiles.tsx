import Link from 'next/link';
import { BellOff, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  TeamAiUsageTile,
  TeamIntelligenceTiles as Tiles,
  TeamNoiseLoadTile,
} from '@/lib/intelligence/surfaces/team-tiles';
import { formatUsd } from '@/lib/intelligence/ai/pricing';
import { formatCount, formatPercent } from '@/lib/intelligence/overview/window';
import { OVERVIEW_CHART_VARS } from '@/components/intelligence/overview/primitives';
import { cn } from '@/lib/utils';

/**
 * Two optional tiles on a team's overview: AI usage against the team's daily budget, and the noise load
 * of the team's services (alerts received against incidents created). Each tile is omitted when it has
 * nothing to show; with neither, nothing renders.
 */

function Tile({
  id,
  icon,
  title,
  period,
  children,
  href,
  linkLabel,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  period: string;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={id}
      className="min-w-0 space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-xs"
    >
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-status-shift/15 text-status-shift"
        >
          {icon}
        </span>
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h3>
        <span className="ml-auto text-2xs text-muted-foreground">{period}</span>
      </header>
      {children}
      {href && linkLabel && (
        <Link
          href={href}
          className="inline-flex min-h-11 items-center text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
        >
          {linkLabel}
        </Link>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-xl font-semibold tabular-nums text-foreground">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function AiUsage({ tile, canManage }: { tile: TeamAiUsageTile; canManage: boolean }) {
  const limit =
    tile.dailyCostLimitMicros !== null
      ? `of ${formatUsd(tile.dailyCostLimitMicros)} a day`
      : tile.dailyTokenLimit !== null
        ? `of ${formatCount(tile.dailyTokenLimit)} tokens a day`
        : 'No daily budget set';
  const state =
    tile.utilization >= 1 ? 'Budget reached' : tile.utilization >= 0.8 ? 'Close to budget' : null;
  return (
    <Tile
      id="team-ai-usage"
      icon={<Sparkles className="h-3.5 w-3.5" />}
      title="AI usage"
      period="today (UTC)"
      href={canManage ? '/settings/intelligence/evaluation#ai-spend' : undefined}
      linkLabel="Spend and budgets"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat
          label="Spent today"
          value={tile.todayCostMicros > 0 ? formatUsd(tile.todayCostMicros) : '$0'}
          hint={`${formatCount(tile.todayTokens)} tokens · ${limit}`}
        />
        <Stat
          label={`Last ${tile.days} days`}
          value={tile.periodCostMicros > 0 ? formatUsd(tile.periodCostMicros) : '$0'}
          hint={`${formatCount(tile.periodTokens)} tokens`}
        />
      </dl>
      {tile.hasBudget && (
        <div className={cn('space-y-1', OVERVIEW_CHART_VARS)}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Daily budget used</span>
            <span className="font-medium tabular-nums">
              {formatPercent(tile.utilization)}
              {state && <span className="ml-1.5 font-normal text-muted-foreground">{state}</span>}
            </span>
          </div>
          <div aria-hidden="true" className="h-2 w-full rounded-r bg-muted">
            <div
              className="h-2 rounded-r bg-[var(--overview-accent)]"
              style={{ width: `${Math.max(2, Math.min(100, tile.utilization * 100))}%` }}
            />
          </div>
        </div>
      )}
    </Tile>
  );
}

function NoiseLoad({ tile }: { tile: TeamNoiseLoadTile }) {
  return (
    <Tile
      id="team-noise-load"
      icon={<BellOff className="h-3.5 w-3.5" />}
      title="Noise load"
      period={`last ${tile.days} days`}
      href="/intelligence#overview-noise"
      linkLabel="AIOps overview"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat
          label="Alerts received"
          value={formatCount(tile.alerts)}
          hint={`across ${tile.services} service${tile.services === 1 ? '' : 's'}`}
        />
        <Stat
          label="Incidents created"
          value={formatCount(tile.incidents)}
          hint={`${tile.compressionRatio}× alerts per incident`}
        />
        {(tile.pagesAvoided > 0 || tile.shadowWouldAvoid > 0) && (
          <Stat
            label={tile.pagesAvoided > 0 ? 'Pages avoided' : 'Would avoid (shadow)'}
            value={formatCount(tile.pagesAvoided > 0 ? tile.pagesAvoided : tile.shadowWouldAvoid)}
            hint={
              tile.pagesAvoided > 0 && tile.shadowWouldAvoid > 0
                ? `+${formatCount(tile.shadowWouldAvoid)} in shadow`
                : undefined
            }
          />
        )}
      </dl>
    </Tile>
  );
}

export default function TeamIntelligenceTiles({
  tiles,
  canManage,
}: {
  tiles: Tiles | null;
  canManage: boolean;
}) {
  if (!tiles || (!tiles.aiUsage && !tiles.noiseLoad)) return null;
  return (
    <div data-testid="team-intelligence-tiles" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {tiles.aiUsage && <AiUsage tile={tiles.aiUsage} canManage={canManage} />}
      {tiles.noiseLoad && <NoiseLoad tile={tiles.noiseLoad} />}
    </div>
  );
}
