import { Sparkles } from 'lucide-react';
import type { IncidentAnalysisState } from '@/lib/intelligence/analysis/contract';
import type { StripChip, StripChipTone } from '@/lib/intelligence/incident-ux/strip-contract';
import FreshnessDot from './FreshnessDot';

const TONE_DOT: Record<StripChipTone, string> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-status-info',
  ok: 'bg-status-ok',
  elevated: 'bg-status-elevated',
  critical: 'bg-status-critical',
  shift: 'bg-status-shift',
};

// The page's chip shape (field-styles CHIP_CLASS); the incident page's touch scope (.incident-dense) gives each a 44px hit area.
const CHIP_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
const OPENER_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/**
 * One row of intelligence under the command bar: a chip per fact that has content, and one freshness dot while
 * analysis is unfinished. Server-rendered and silent when silent: with no chip and no dot it renders nothing.
 *
 * Chips are plain links. `?insights=<section>` opens the inspector at that section (the inspector host turns
 * the click into an in-page open; without script the link still loads the page with the inspector open), and
 * `#<anchor>` jumps to a core tab, which is how noise decisions reach their home on the Timeline.
 */
export default function IntelligenceStrip({
  incidentId,
  chips,
  freshness,
  touch = false,
  bare = false,
}: {
  incidentId: string;
  chips: StripChip[];
  /** The mobile route: keep 44 px targets at every width, including a phone held sideways. */
  touch?: boolean;
  /** Present only while analysis is unfinished, failed or unverifiable. */
  freshness: IncidentAnalysisState | null;
  /** Inside another card (the AI briefing): no border, background or opener of its own; chips wrap. */
  bare?: boolean;
}) {
  if (chips.length === 0 && !freshness) return null;
  const chipClass = CHIP_CLASS;
  const firstSection = chips.flatMap(chip =>
    'section' in chip.target ? [chip.target.section] : []
  )[0];
  return (
    <div
      data-testid="intelligence-strip"
      className={
        bare
          ? 'flex min-w-0 items-center gap-2'
          : touch
            ? 'flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 text-card-foreground'
            : 'flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 text-card-foreground'
      }
    >
      {chips.length > 0 && (
        <nav
          aria-label="Incident insights"
          // Chips scroll sideways: the trailing edge fades so a cut-off chip reads as "more this way".
          // Phones wrap instead: a sideways scroll hides chips nobody knows are there.
          className={
            bare || touch
              ? 'flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1'
              : 'flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 pr-6 scrollbar-none mask-[linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]'
          }
        >
          {firstSection && !bare && (
            <a href={`?insights=${firstSection}`} data-insights-open="" className={OPENER_CLASS}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Insights
              <kbd
                className="hidden rounded border border-border bg-muted px-1 font-mono text-2xs font-normal lg:inline"
                title="Keyboard shortcut: I"
              >
                I
              </kbd>
            </a>
          )}
          <ul
            className={
              bare || touch ? 'flex flex-wrap items-center gap-1.5' : 'flex items-center gap-1.5'
            }
          >
            {chips.map(chip => (
              <li key={chip.id} className="flex shrink-0">
                {'section' in chip.target ? (
                  <a
                    href={`?insights=${chip.target.section}`}
                    data-insights-open={chip.target.section}
                    className={chipClass}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[chip.tone]}`}
                      aria-hidden="true"
                    />
                    {chip.label}
                  </a>
                ) : (
                  <a href={`#${chip.target.anchor}`} className={chipClass}>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[chip.tone]}`}
                      aria-hidden="true"
                    />
                    {chip.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
      {freshness && (
        <FreshnessDot
          incidentId={incidentId}
          initial={freshness}
          align={chips.length ? 'end' : 'start'}
          touch={touch}
        />
      )}
    </div>
  );
}
