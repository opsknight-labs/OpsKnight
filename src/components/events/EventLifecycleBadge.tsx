import { memo } from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import { Eye, CheckCircle2, ArrowRightCircle, MessageSquare, Activity, Flame } from 'lucide-react';

export type EventLifecycleBadgeProps = {
  message: string;
  className?: string;
};

export type EventCategory =
  'triggered' | 'acknowledged' | 'resolved' | 'escalated' | 'note' | 'general';

export function getEventCategory(message: string): EventCategory {
  const lower = message.toLowerCase();

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

function EventLifecycleBadge({ message, className }: EventLifecycleBadgeProps) {
  const { label, tone, icon: Icon } = CATEGORY_DISPLAY[getEventCategory(message)];
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
