import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Eye, CheckCircle2, ArrowRightCircle, MessageSquare, Activity, Flame } from 'lucide-react';

export type EventLifecycleBadgeProps = {
  message: string;
  className?: string;
};

export type EventCategory =
  | 'triggered'
  | 'acknowledged'
  | 'resolved'
  | 'escalated'
  | 'note'
  | 'general';

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

function EventLifecycleBadge({ message, className }: EventLifecycleBadgeProps) {
  const category = getEventCategory(message);

  switch (category) {
    case 'triggered':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80',
            className
          )}
        >
          <Flame className="h-3 w-3 text-rose-600" />
          <span>TRIGGER</span>
        </span>
      );
    case 'acknowledged':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80',
            className
          )}
        >
          <Eye className="h-3 w-3 text-amber-600" />
          <span>ACK</span>
        </span>
      );
    case 'resolved':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80',
            className
          )}
        >
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
          <span>RESOLVED</span>
        </span>
      );
    case 'escalated':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/80',
            className
          )}
        >
          <ArrowRightCircle className="h-3 w-3 text-blue-600" />
          <span>ESCALATED</span>
        </span>
      );
    case 'note':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200/80',
            className
          )}
        >
          <MessageSquare className="h-3 w-3 text-purple-600" />
          <span>NOTE</span>
        </span>
      );
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80',
            className
          )}
        >
          <Activity className="h-3 w-3 text-slate-600" />
          <span>EVENT</span>
        </span>
      );
  }
}

export default memo(EventLifecycleBadge);
