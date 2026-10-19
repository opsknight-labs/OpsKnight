import { cn } from '@/lib/utils';
import { TONE_SURFACE, type Tone } from './ui/primitives';

export type RunbookStatusBadgeProps = {
  status: string;
  className?: string;
  showIcon?: boolean;
  size?: 'sm' | 'default';
  context?: 'execution' | 'agent' | 'health' | 'lifecycle' | 'default';
};

type StatusStyle = { label: string; tone: Tone; pulse?: boolean };

const STATUS_STYLES: Record<string, StatusStyle> = {
  // Executions and step attempts
  SUCCEEDED: { label: 'Succeeded', tone: 'success' },
  RUNNING: { label: 'Running', tone: 'info', pulse: true },
  QUEUED: { label: 'Queued', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'neutral' },
  CLAIMED: { label: 'Claimed', tone: 'info', pulse: true },
  WAITING_APPROVAL: { label: 'Waiting approval', tone: 'warning', pulse: true },
  WAITING_AGENT: { label: 'Waiting agent', tone: 'warning', pulse: true },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  CANCEL_REQUESTED: { label: 'Cancel requested', tone: 'neutral', pulse: true },
  TIMED_OUT: { label: 'Timed out', tone: 'danger' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  // Agent fleet
  ONLINE: { label: 'Online', tone: 'success' },
  DEGRADED: { label: 'Degraded', tone: 'warning' },
  OFFLINE: { label: 'Offline', tone: 'danger' },
  ENROLLING: { label: 'Enrolling', tone: 'info', pulse: true },
  REVOKED: { label: 'Revoked', tone: 'neutral' },
  // Runbook lifecycle
  PUBLISHED: { label: 'Published', tone: 'success' },
  DRAFT: { label: 'Draft', tone: 'warning' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
  RETIRED: { label: 'Retired', tone: 'neutral' },
  // Signing identities
  ACTIVE: { label: 'Active', tone: 'success' },
  NEXT: { label: 'Next', tone: 'info' },
  RETIRING: { label: 'Retiring', tone: 'warning' },
  // Health
  HEALTHY: { label: 'Healthy', tone: 'success' },
};
const STATUS_MAP = new Map(Object.entries(STATUS_STYLES));

const SURFACE = new Map(Object.entries(TONE_SURFACE) as Array<[Tone, string]>);
const DOT = new Map<Tone, string>([
  ['neutral', 'bg-muted-foreground/60'],
  ['success', 'bg-emerald-500'],
  ['warning', 'bg-amber-500'],
  ['danger', 'bg-rose-500'],
  ['info', 'bg-sky-500'],
  ['brand', 'bg-primary'],
]);

function sentenceCase(value: string) {
  const words = value.replaceAll('_', ' ').toLowerCase().trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Unknown';
}

function resolveStatus(
  normalized: string,
  context: RunbookStatusBadgeProps['context']
): StatusStyle {
  if (normalized === 'UNKNOWN') {
    return context === 'health'
      ? { label: 'Health unknown', tone: 'neutral' }
      : { label: 'Unknown outcome', tone: 'danger' };
  }
  return STATUS_MAP.get(normalized) ?? { label: sentenceCase(normalized), tone: 'neutral' };
}

export function RunbookStatusBadge({
  status,
  className,
  showIcon = true,
  size = 'default',
  context = 'default',
}: RunbookStatusBadgeProps) {
  const normalized = (status || '').toUpperCase();
  const { label, tone, pulse } = resolveStatus(normalized, context);
  const dot = DOT.get(tone);

  return (
    <span
      data-status={normalized || undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset transition-colors',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs',
        SURFACE.get(tone),
        className
      )}
    >
      {showIcon && (
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
          {pulse && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden',
                dot
              )}
            />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', dot)} />
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}
