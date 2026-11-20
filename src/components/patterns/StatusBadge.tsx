import { memo } from 'react';
import {
  AlarmClockOff,
  AlertTriangle,
  BellOff,
  CheckCircle2,
  CircleDashed,
  Eye,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { incidentStatusTone } from '@/lib/design/status-palette';
import { toneClasses } from './status-tone';

export type BadgeSize = 'xs' | 'sm' | 'md';

/** Shared pill geometry for StatusBadge and SeverityBadge. */
export const BADGE_BASE_CLASS =
  'inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border font-semibold leading-none';

export const BADGE_SIZE_CLASS: Record<BadgeSize, string> = {
  xs: 'h-5 gap-1 px-1.5 text-2xs [&_svg]:h-3 [&_svg]:w-3',
  sm: 'h-6 gap-1 px-2 text-2xs [&_svg]:h-3.5 [&_svg]:w-3.5',
  md: 'h-7 gap-1.5 px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5',
};

export function badgeSizeClass(size: BadgeSize): string {
  switch (size) {
    case 'xs':
      return BADGE_SIZE_CLASS.xs;
    case 'md':
      return BADGE_SIZE_CLASS.md;
    default:
      return BADGE_SIZE_CLASS.sm;
  }
}

type StatusMeta = { label: string; icon: LucideIcon };

function statusMeta(key: string): StatusMeta {
  switch (key) {
    case 'OPEN':
    case 'TRIGGERED':
      return { label: 'Triggered', icon: AlertTriangle };
    case 'ACKNOWLEDGED':
      return { label: 'Acknowledged', icon: Eye };
    case 'SNOOZED':
      return { label: 'Snoozed', icon: AlarmClockOff };
    case 'SUPPRESSED':
      return { label: 'Suppressed', icon: BellOff };
    case 'RESOLVED':
      return { label: 'Resolved', icon: CheckCircle2 };
    default:
      return {
        label: key ? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ') : 'Unknown',
        icon: CircleDashed,
      };
  }
}

/** Human label for an incident status (`OPEN` reads as "Triggered"). */
export function incidentStatusLabel(status: string | null | undefined): string {
  return statusMeta((status ?? '').toUpperCase()).label;
}

export type StatusBadgeProps = {
  /** Incident status: TRIGGERED/OPEN, ACKNOWLEDGED, SNOOZED, SUPPRESSED or RESOLVED. */
  status: string;
  size?: BadgeSize;
  /** `solid` fills the pill with the tone; use for the row's primary signals. */
  variant?: 'soft' | 'solid';
  /** Override the visible label; the tone and icon still follow `status`. */
  label?: string;
  /** Pulse the icon halo. Reserve for live, unacknowledged incidents. */
  live?: boolean;
  className?: string;
};

/**
 * Incident status pill: icon + text on the tone's soft fill. The tone always comes
 * from `incidentStatusTone()`; SUPPRESSED and unknown values are neutral.
 */
function StatusBadge({
  status,
  size = 'sm',
  variant = 'soft',
  label,
  live = false,
  className,
}: StatusBadgeProps) {
  const key = (status ?? '').toUpperCase();
  const tone = incidentStatusTone(key);
  const meta = statusMeta(key);
  const Icon = meta.icon;
  const showPulse = live && tone === 'critical';

  return (
    <span
      data-status={key.toLowerCase()}
      data-tone={tone ?? 'neutral'}
      title={`Status: ${label ?? meta.label}`}
      className={cn(
        BADGE_BASE_CLASS,
        badgeSizeClass(size),
        variant === 'solid' ? toneClasses(tone).filled : toneClasses(tone).soft,
        className
      )}
    >
      <span className="relative inline-flex shrink-0" aria-hidden="true">
        {showPulse && (
          <span className="absolute inset-0 rounded-full bg-current opacity-30 motion-safe:animate-ping" />
        )}
        <Icon className="relative shrink-0" strokeWidth={2.25} />
      </span>
      <span className="truncate">{label ?? meta.label}</span>
    </span>
  );
}

export default memo(StatusBadge);
