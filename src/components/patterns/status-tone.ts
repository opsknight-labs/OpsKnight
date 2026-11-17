import type { StatusTone } from '@/lib/design/status-palette';

/**
 * Class recipes per semantic tone. Every colour comes from the `status-*` Tailwind
 * scale generated from `src/lib/design/status-palette.ts`; dark mode keeps the
 * palette fill/border at low alpha and lifts the text to the `-300` shade for AA
 * contrast on zinc surfaces. Tailwind JIT needs the literal strings below.
 */
export type ToneKey = StatusTone | 'neutral';

type ToneRecipe = {
  /** Soft pill: tinted fill, hairline border, deep text. */
  soft: string;
  /** Solid dot / accent bar fill. */
  solid: string;
  /** Hover border for rows tinted by tone. */
  hoverBorder: string;
  /** Left accent rule colour (pair with a `border-l-*` width). */
  borderLeft: string;
  /** Foreground text tinted by tone. */
  text: string;
};

const TONE_RECIPES: Record<ToneKey, ToneRecipe> = {
  critical: {
    soft: 'border-status-critical-border/25 bg-status-critical-soft text-status-critical-deep dark:border-status-critical/35 dark:bg-status-critical/15 dark:text-rose-300',
    solid: 'bg-status-critical',
    hoverBorder: 'hover:border-status-critical-border/40',
    borderLeft: 'border-l-status-critical',
    text: 'text-status-critical-deep dark:text-rose-300',
  },
  elevated: {
    soft: 'border-status-elevated-border/30 bg-status-elevated-soft text-status-elevated-deep dark:border-status-elevated/35 dark:bg-status-elevated/15 dark:text-amber-300',
    solid: 'bg-status-elevated',
    hoverBorder: 'hover:border-status-elevated-border/40',
    borderLeft: 'border-l-status-elevated',
    text: 'text-status-elevated-deep dark:text-amber-300',
  },
  ok: {
    soft: 'border-status-ok-border/30 bg-status-ok-soft text-status-ok-deep dark:border-status-ok/35 dark:bg-status-ok/15 dark:text-emerald-300',
    solid: 'bg-status-ok',
    hoverBorder: 'hover:border-status-ok-border/40',
    borderLeft: 'border-l-status-ok',
    text: 'text-status-ok-deep dark:text-emerald-300',
  },
  info: {
    soft: 'border-status-info-border/25 bg-status-info-soft text-status-info-deep dark:border-status-info/35 dark:bg-status-info/15 dark:text-blue-300',
    solid: 'bg-status-info',
    hoverBorder: 'hover:border-status-info-border/40',
    borderLeft: 'border-l-status-info',
    text: 'text-status-info-deep dark:text-blue-300',
  },
  shift: {
    soft: 'border-status-shift-border/25 bg-status-shift-soft text-status-shift-deep dark:border-status-shift/35 dark:bg-status-shift/15 dark:text-violet-300',
    solid: 'bg-status-shift',
    hoverBorder: 'hover:border-status-shift-border/40',
    borderLeft: 'border-l-status-shift',
    text: 'text-status-shift-deep dark:text-violet-300',
  },
  neutral: {
    // ink-600, not muted-foreground: muted text on the muted fill is only 4.3:1 in light mode.
    soft: 'border-border bg-muted text-ink-600',
    solid: 'bg-ink-400',
    hoverBorder: 'hover:border-ink-300',
    borderLeft: 'border-l-ink-400',
    text: 'text-muted-foreground',
  },
};

export function toneClasses(tone: StatusTone | null | undefined): ToneRecipe {
  switch (tone) {
    case 'critical':
      return TONE_RECIPES.critical;
    case 'elevated':
      return TONE_RECIPES.elevated;
    case 'ok':
      return TONE_RECIPES.ok;
    case 'info':
      return TONE_RECIPES.info;
    case 'shift':
      return TONE_RECIPES.shift;
    default:
      return TONE_RECIPES.neutral;
  }
}
