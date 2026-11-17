import { memo } from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import { Eye, CheckCircle2, ArrowRightCircle, MessageSquare, Activity, Flame } from 'lucide-react';

export type EventLifecycleBadgeProps = {
  message: string;
  /** The typed IncidentEvent.type column; authoritative whenever it is set. */
  type?: string | null;
  className?: string;
};

export type EventCategory =
  'triggered' | 'acknowledged' | 'resolved' | 'escalated' | 'note' | 'general';

const TYPED_CATEGORIES = new Map<string, EventCategory>([
  ['ACKNOWLEDGED', 'acknowledged'],
  ['ESCALATED', 'escalated'],
  ['ASSIGNMENT', 'escalated'],
  ['REOPENED', 'triggered'],
  ['AUTO_RESOLVED', 'resolved'],
  ['MANUAL_RESOLVED', 'resolved'],
  ['COMMENT', 'note'],
  ['STATUS_CHANGE', 'general'],
]);

export function getEventCategory(message: string, type?: string | null): EventCategory {
  if (type && type !== 'LEGACY_OTHER') return TYPED_CATEGORIES.get(type) ?? 'general';
  const lower = message.toLowerCase();

  // Held incidents (flapping, maintenance) did not page anyone.
  if (lower.includes('suppressed')) return 'general';
  // Checked before 'assigned' below, which would otherwise claim "reassigned".
  if (lower.includes('reassigned')) return 'escalated';

  if (
    lower.includes('triggered') ||
    lower.includes('critical') ||
    lower.includes('alert') ||
    lower.includes('outage')
  ) {
    return 'triggered';
  }

  if (
    lower.includes('acknowledged') ||
    lower.includes('assigned') ||
    lower.includes('investigating')
  ) {
    return 'acknowledged';
  }

  if (
    lower.includes('resolved') ||
    lower.includes('closed') ||
    lower.includes('healthy') ||
    lower.includes('operational')
  ) {
    return 'resolved';
  }

  if (
    lower.includes('escalated') ||
    lower.includes('reassigned') ||
    lower.includes('forwarded') ||
    lower.includes('handoff')
  ) {
    return 'escalated';
  }

  if (
    lower.includes('note') ||
    lower.includes('war room') ||
    lower.includes('slack') ||
    lower.includes('comment')
  ) {
    return 'note';
  }

  return 'general';
}

const CATEGORY_DISPLAY: Record<
  EventCategory,
  { label: string; tone: ToneKey; icon: typeof Activity }
> = {
  triggered: { label: 'Triggered', tone: 'critical', icon: Flame },
  acknowledged: { label: 'Acknowledged', tone: 'elevated', icon: Eye },
  resolved: { label: 'Resolved', tone: 'ok', icon: CheckCircle2 },
  escalated: { label: 'Escalated', tone: 'info', icon: ArrowRightCircle },
  note: { label: 'Note', tone: 'neutral', icon: MessageSquare },
  general: { label: 'Event', tone: 'neutral', icon: Activity },
};

function EventLifecycleBadge({ message, type, className }: EventLifecycleBadgeProps) {
  const { label, tone, icon: Icon } = CATEGORY_DISPLAY[getEventCategory(message, type)];
  return (
    <span
      className={cn(
        BADGE_BASE_CLASS,
        badgeSizeClass('sm'),
        toneClasses(tone === 'neutral' ? null : tone).soft,
        className
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}

export default memo(EventLifecycleBadge);
