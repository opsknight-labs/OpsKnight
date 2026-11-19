import { memo } from 'react';
import { cn } from '@/lib/utils';
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

function EventLifecycleBadge({ message, type, className }: EventLifecycleBadgeProps) {
  const category = getEventCategory(message, type);

  switch (category) {
    case 'triggered':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
            className
          )}
        >
          <Flame className="h-3 w-3 text-rose-600 dark:text-rose-400" />
          <span>TRIGGER</span>
        </span>
      );
    case 'acknowledged':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
            className
          )}
        >
          <Eye className="h-3 w-3 text-amber-600 dark:text-amber-400" />
          <span>ACK</span>
        </span>
      );
    case 'resolved':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
            className
          )}
        >
          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span>RESOLVED</span>
        </span>
      );
    case 'escalated':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
            className
          )}
        >
          <ArrowRightCircle className="h-3 w-3 text-blue-600 dark:text-blue-400" />
          <span>ESCALATED</span>
        </span>
      );
    case 'note':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200/80 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30',
            className
          )}
        >
          <MessageSquare className="h-3 w-3 text-purple-600 dark:text-purple-400" />
          <span>NOTE</span>
        </span>
      );
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-ink-100 text-ink-700 border border-ink-200/80',
            className
          )}
        >
          <Activity className="h-3 w-3 text-ink-600" />
          <span>EVENT</span>
        </span>
      );
  }
}

export default memo(EventLifecycleBadge);
