/**
 * OpsKnight status colour semantics, the single source of truth for
 * AGENTS.md "Status Color Semantics".
 *
 * - `deep` → `base` is the brand gradient used on headers, badges and primary buttons
 * - `border` is the accent border (e.g. 4px left rule on description cards)
 * - `soft` is the tinted light-mode surface
 *
 * The values feed Tailwind (`theme.extend.colors.status`), so components use
 * classes such as `from-status-critical-deep to-status-critical` and
 * `bg-status-ok-soft`, and emails import the same constants. A test pins
 * them to the documented hex values.
 */
export const STATUS_PALETTE = {
  /** Critical / Triggered / High urgency: Crimson Red */
  critical: { deep: '#881337', base: '#e11d48', border: '#be123c', soft: '#fef2f2' },
  /** Elevated / Medium urgency / Acknowledged: Warm Amber */
  elevated: { deep: '#78350f', base: '#d97706', border: '#d97706', soft: '#fffbeb' },
  /** Resolved / Operational / Success: Emerald Green */
  ok: { deep: '#047857', base: '#059669', border: '#059669', soft: '#f0fdf4' },
  /** Standard / Low urgency / Info: Cobalt Blue */
  info: { deep: '#1e3a8a', base: '#3b82f6', border: '#2563eb', soft: '#eff6ff' },
  /** On-call shifts & rotations: Royal Violet */
  shift: { deep: '#4c1d95', base: '#7c3aed', border: '#7c3aed', soft: '#f5f3ff' },
} as const;

export type StatusTone = keyof typeof STATUS_PALETTE;

/** Tailwind colour map: `status-<tone>` (base), `-deep`, `-border`, `-soft`. */
export const STATUS_TAILWIND_COLORS = Object.fromEntries(
  Object.entries(STATUS_PALETTE).map(([tone, c]) => [
    tone,
    { DEFAULT: c.base, deep: c.deep, border: c.border, soft: c.soft },
  ])
) as Record<StatusTone, { DEFAULT: string; deep: string; border: string; soft: string }>;

/** Brand gradient utility classes per tone (Tailwind JIT needs literal strings). */
export function statusGradientClass(tone: StatusTone): string {
  switch (tone) {
    case 'critical':
      return 'from-status-critical-deep to-status-critical';
    case 'elevated':
      return 'from-status-elevated-deep to-status-elevated';
    case 'ok':
      return 'from-status-ok-deep to-status-ok';
    case 'info':
      return 'from-status-info-deep to-status-info';
    case 'shift':
      return 'from-status-shift-deep to-status-shift';
  }
}

/** Maps an incident status to its semantic tone. */
export function incidentStatusTone(status: string | null | undefined): StatusTone | null {
  switch ((status ?? '').toUpperCase()) {
    case 'OPEN':
    case 'TRIGGERED':
      return 'critical';
    case 'ACKNOWLEDGED':
      return 'elevated';
    case 'RESOLVED':
      return 'ok';
    case 'SNOOZED':
      return 'info';
    default:
      return null;
  }
}

/** Maps an incident urgency to its semantic tone. */
export function urgencyTone(urgency: string | null | undefined): StatusTone | null {
  switch ((urgency ?? '').toUpperCase()) {
    case 'HIGH':
    case 'CRITICAL':
      return 'critical';
    case 'MEDIUM':
      return 'elevated';
    case 'LOW':
      return 'info';
    default:
      return null;
  }
}
