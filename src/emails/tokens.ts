/**
 * Email design tokens.
 *
 * Status ramps (deep/base/border/soft) come from the app's single source of truth,
 * src/lib/design/status-palette.ts, which mirrors AGENTS.md "Status Color Semantics"
 * (critical → crimson, elevated → amber, ok → emerald, info → cobalt, shift → royal violet).
 * `button` is the solid fill used for CTAs and badges: every value passes
 * WCAG AA (≥ 4.5:1) against white text, which the lighter `base` shades
 * (amber/emerald/blue) do not.
 */
import { STATUS_PALETTE } from '../lib/design/status-palette';

export type EmailTone = 'critical' | 'elevated' | 'ok' | 'info' | 'shift' | 'neutral';

export type ToneTokens = {
  /** Gradient start and Outlook solid fallback for the header band. */
  deep: string;
  /** Gradient end. */
  base: string;
  /** Solid CTA / badge fill (AA with white text). */
  button: string;
  /** 4px accent rules and card borders. */
  border: string;
  /** Tinted light surface for callouts. */
  soft: string;
  /** Text colour on `soft` surfaces (AA). */
  ink: string;
  /** Dark-mode tinted surface for callouts. */
  softDark: string;
  /** Dark-mode text colour on `softDark`. */
  inkDark: string;
};

export const TONES: Record<EmailTone, ToneTokens> = {
  critical: {
    ...STATUS_PALETTE.critical,
    button: '#be123c',
    ink: '#881337',
    softDark: '#3b0d1c',
    inkDark: '#fecdd3',
  },
  elevated: {
    ...STATUS_PALETTE.elevated,
    button: '#b45309',
    ink: '#78350f',
    softDark: '#3a2208',
    inkDark: '#fde68a',
  },
  ok: {
    ...STATUS_PALETTE.ok,
    button: '#047857',
    ink: '#065f46',
    softDark: '#062e22',
    inkDark: '#a7f3d0',
  },
  info: {
    ...STATUS_PALETTE.info,
    button: '#2563eb',
    ink: '#1e3a8a',
    softDark: '#0f1f45',
    inkDark: '#bfdbfe',
  },
  shift: {
    ...STATUS_PALETTE.shift,
    button: '#6d28d9',
    ink: '#4c1d95',
    softDark: '#24124a',
    inkDark: '#ddd6fe',
  },
  neutral: {
    deep: '#0f172a',
    base: '#334155',
    button: '#1e293b',
    border: '#475569',
    soft: '#f8fafc',
    ink: '#1e293b',
    softDark: '#162033',
    inkDark: '#e2e8f0',
  },
};

/** Tone lookup without dynamic property access. */
export function toneTokens(tone: EmailTone): ToneTokens {
  switch (tone) {
    case 'critical':
      return TONES.critical;
    case 'elevated':
      return TONES.elevated;
    case 'ok':
      return TONES.ok;
    case 'info':
      return TONES.info;
    case 'shift':
      return TONES.shift;
    default:
      return TONES.neutral;
  }
}

/** Light surfaces use off-white / off-black so forced-inversion clients don't blow them out. */
export const SURFACE = {
  light: {
    page: '#f3f5f8',
    card: '#ffffff',
    muted: '#f8fafc',
    border: '#e2e8f0',
    heading: '#0f172a',
    body: '#334155',
    muted_text: '#5a6678',
    link: '#2563eb',
  },
  dark: {
    page: '#0b1220',
    card: '#111a2e',
    muted: '#0f1729',
    border: '#26324a',
    heading: '#f1f5f9',
    body: '#cbd5e1',
    muted_text: '#94a3b8',
    link: '#93c5fd',
  },
} as const;

/**
 * Mail clients cannot load the app's bundled fonts, so name the brand faces
 * first and fall back to system UI fonts. Outlook (Word) ignores the stack when
 * the first face is missing and drops to Times New Roman, so the layout also
 * forces Segoe UI / Arial inside an `<!--[if mso]>` style block.
 */
export const FONT_BODY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_DISPLAY =
  "'Space Grotesk', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace";

/** Outlook desktop ignores media queries, so it always gets this fixed width. */
export const OUTLOOK_WIDTH = 640;
