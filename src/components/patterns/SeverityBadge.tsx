import { memo } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Info,
  ShieldAlert,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { priorityTone, urgencyTone } from '@/lib/design/status-palette';
import { BADGE_BASE_CLASS, badgeSizeClass, type BadgeSize } from './StatusBadge';
import { toneClasses } from './status-tone';

type SeverityMeta = {
  text: string;
  /** Screen-reader context around the visible text ("Priority " / " urgency"). */
  srPrefix?: string;
  srSuffix?: string;
  /** Full spoken label when the visible text is abbreviated. */
  srLabel?: string;
  icon: LucideIcon;
};

function titleCase(key: string): string {
  return key.charAt(0) + key.slice(1).toLowerCase();
}

function urgencyMeta(key: string, abbreviate: boolean): SeverityMeta {
  const meta = (text: string, icon: LucideIcon): SeverityMeta => ({
    text,
    srSuffix: ' urgency',
    icon,
  });
  switch (key) {
    case 'HIGH':
    case 'CRITICAL':
      return meta(titleCase(key), SignalHigh);
    case 'MEDIUM':
      return abbreviate
        ? { text: 'Med', srLabel: 'Medium urgency', icon: SignalMedium }
        : meta('Medium', SignalMedium);
    case 'LOW':
      return meta('Low', SignalLow);
    default:
      return meta(titleCase(key), Info);
  }
}

function priorityMeta(key: string, showLabel: boolean): SeverityMeta {
  const meta = (label: string, icon: LucideIcon): SeverityMeta => ({
    text: showLabel ? `${key} · ${label}` : key,
    srPrefix: 'Priority ',
    icon,
  });
  switch (key) {
    case 'P1':
      return meta('Crisis', ShieldAlert);
    case 'P2':
      return meta('High', ArrowUp);
    case 'P3':
      return meta('Medium', AlertCircle);
    case 'P4':
      return meta('Low', Zap);
    case 'P5':
      return meta('Info', Info);
    default:
      return { text: key, srPrefix: 'Priority ', icon: Info };
  }
}

export type SeverityBadgeProps = {
  /** Incident urgency (HIGH / MEDIUM / LOW). Ignored when `priority` is set. */
  urgency?: string | null;
  /** Incident priority (P1–P5). */
  priority?: string | null;
  size?: BadgeSize;
  /** `solid` fills the pill with the tone; use for the row's primary signals. */
  variant?: 'soft' | 'solid';
  /** Priority only: append the name ("P1 · Crisis"). */
  showLabel?: boolean;
  /** Urgency only: shorten Medium to Med for dense rows. */
  abbreviate?: boolean;
  /** Drop the icon in the densest rows only; the text already names the level. */
  hideIcon?: boolean;
  className?: string;
};

/**
 * Urgency or priority pill with an icon. Tones come from `urgencyTone()` /
 * `priorityTone()`; renders nothing when no value is given.
 */
function SeverityBadge({
  urgency,
  priority,
  size = 'sm',
  variant = 'soft',
  showLabel = true,
  abbreviate = false,
  hideIcon = false,
  className,
}: SeverityBadgeProps) {
  const isPriority = Boolean(priority);
  const raw = (isPriority ? priority : urgency) ?? '';
  if (!raw) return null;

  const key = raw.toUpperCase();
  const tone = isPriority ? priorityTone(key) : urgencyTone(key);
  const meta = isPriority ? priorityMeta(key, showLabel) : urgencyMeta(key, abbreviate);
  const Icon = meta.icon;
  const description = meta.srLabel ?? `${meta.srPrefix ?? ''}${meta.text}${meta.srSuffix ?? ''}`;

  return (
    <span
      data-severity={isPriority ? 'priority' : 'urgency'}
      data-value={key.toLowerCase()}
      data-tone={tone ?? 'neutral'}
      title={description}
      className={cn(
        BADGE_BASE_CLASS,
        badgeSizeClass(size),
        'tabular-nums',
        variant === 'solid' ? toneClasses(tone).filled : toneClasses(tone).soft,
        className
      )}
    >
      {!hideIcon && <Icon className="shrink-0" strokeWidth={2.25} aria-hidden="true" />}
      {meta.srPrefix && <span className="sr-only">{meta.srPrefix}</span>}
      <span className="truncate" aria-hidden={meta.srLabel ? true : undefined}>
        {meta.text}
      </span>
      {meta.srSuffix && <span className="sr-only">{meta.srSuffix}</span>}
      {meta.srLabel && <span className="sr-only">{meta.srLabel}</span>}
    </span>
  );
}

export default memo(SeverityBadge);
