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

const CHIP_CLASS =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const OPENER_CLASS =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
}: {
  incidentId: string;
  chips: StripChip[];
  /** The mobile route: keep 44 px targets at every width, including a phone held sideways. */
  touch?: boolean;
  /** Present only while analysis is unfinished, failed or unverifiable. */
  freshness: IncidentAnalysisState | null;
}) {
  if (chips.length === 0 && !freshness) return null;
  const chipClass = touch ? CHIP_CLASS : `${CHIP_CLASS} sm:min-h-7`;
  const firstSection = chips.flatMap(chip =>
    'section' in chip.target ? [chip.target.section] : []
  )[0];
  return (
    <div
      data-testid="intelligence-strip"
      className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 text-card-foreground"
    >
      {chips.length > 0 && (
        <nav
          aria-label="Incident insights"
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none"
        >
          {firstSection && (
            <a
              href={`?insights=${firstSection}`}
              data-insights-open=""
              className={touch ? OPENER_CLASS : `${OPENER_CLASS} sm:min-h-7`}
            >
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
          <ul className="flex items-center gap-1.5">
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
