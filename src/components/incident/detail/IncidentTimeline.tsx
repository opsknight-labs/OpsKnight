'use client';

import { useState } from 'react';
import _TimelineEvent from '../TimelineEvent';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { Clock, AlertCircle, CheckCircle2, Target, Activity, MessageSquare } from 'lucide-react';

type TimelineFilter =
  | 'ALL'
  | 'LIFECYCLE'
  | 'ESCALATION'
  | 'ASSIGNMENT'
  | 'NOTIFICATIONS'
  | 'INTEGRATIONS'
  | 'NOTES';

const FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'LIFECYCLE', label: 'Lifecycle' },
  { id: 'ESCALATION', label: 'Escalation' },
  { id: 'ASSIGNMENT', label: 'Assignment' },
  { id: 'NOTIFICATIONS', label: 'Notifications' },
  { id: 'INTEGRATIONS', label: 'Integrations' },
  { id: 'NOTES', label: 'Notes' },
];

// Best-effort categorization from the free-text event message — there's no
// structured "category" field on IncidentEvent, so this is a heuristic filter,
// not an authoritative classification.
export function categorize(type: string, message: string): TimelineFilter {
  if (type === 'NOTE' || type === 'COMMENT') return 'NOTES';
  if (type === 'CREATED' || type === 'ACKNOWLEDGED' || type === 'RESOLVED') return 'LIFECYCLE';
  if (/\bnote\b|pinned message|comment/i.test(message)) return 'NOTES';
  if (/escalat/i.test(message)) return 'ESCALATION';
  if (/assign|unassigned/i.test(message)) return 'ASSIGNMENT';
  if (/notif|paged?\b|alert sent|sms|call attempt/i.test(message)) return 'NOTIFICATIONS';
  if (/jira|slack|webhook|integration|war.?room/i.test(message)) return 'INTEGRATIONS';
  if (/triggered|created|resolved|acknowledged|snooz|suppress|reopen/i.test(message))
    return 'LIFECYCLE';
  return 'ALL';
}

export type Event = {
  id: string;
  message: string;
  type?: string | null;
  createdAt: Date;
};

export type Note = {
  id: string;
  content: string;
  createdAt: Date;
  user?: {
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  } | null;
};

export type IncidentTimelineProps = {
  events: Event[];
  notes?: Note[];
  incidentCreatedAt?: Date;
  incidentAcknowledgedAt?: Date | null;
  incidentResolvedAt?: Date | null;
};

export default function IncidentTimeline({
  events,
  notes = [],
  incidentCreatedAt,
  incidentAcknowledgedAt,
  incidentResolvedAt,
}: IncidentTimelineProps) {
  const { userTimeZone } = useTimezone();
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>('ALL');

  const formatEscalationMessage = (message: string) => {
    return message.replace(/\[\[scheduledAt=([^\]]+)\]\]/g, (_match, scheduledAtRaw) => {
      const scheduledAt = new Date(scheduledAtRaw);
      if (Number.isNaN(scheduledAt.getTime())) {
        return scheduledAtRaw;
      }
      return formatDateTime(scheduledAt, userTimeZone, { format: 'datetime' });
    });
  };

  // Create a comprehensive timeline with incident lifecycle events and notes
  const timelineEvents: Array<{
    id: string;
    message: string;
    createdAt: Date;
    type: string;
    sortPriority: number;
  }> = [];

  const hasCreatedDbEvent = events.some(e => /triggered|created/i.test(e.message));
  const hasAckDbEvent = events.some(e => /acknowledged/i.test(e.message));
  const hasResolveDbEvent = events.some(e => /resolved/i.test(e.message));

  // Add incident creation
  if (incidentCreatedAt && !hasCreatedDbEvent) {
    timelineEvents.push({
      id: 'incident-created',
      message: 'Incident triggered and created',
      createdAt: incidentCreatedAt,
      type: 'CREATED',
      sortPriority: 0,
    });
  }

  // Add acknowledgment
  if (incidentAcknowledgedAt && !hasAckDbEvent) {
    timelineEvents.push({
      id: 'incident-acknowledged',
      message: 'Incident acknowledged by responder',
      createdAt: incidentAcknowledgedAt,
      type: 'ACKNOWLEDGED',
      sortPriority: 1,
    });
  }

  // Add resolution
  if (incidentResolvedAt && !hasResolveDbEvent) {
    timelineEvents.push({
      id: 'incident-resolved',
      message: 'Incident marked as resolved',
      createdAt: incidentResolvedAt,
      type: 'RESOLVED',
      sortPriority: 2,
    });
  }

  // Track matched notes to prevent duplicates when an incidentEvent already exists for a note
  const matchedNoteIds = new Set<string>();

  // Add regular events
  events.forEach(event => {
    const isNoteEvent =
      event.type === 'NOTE' ||
      event.type === 'COMMENT' ||
      /\bnote\b|pinned message|comment/i.test(event.message);

    let message = event.message;
    let eventType = event.type || 'EVENT';

    if (isNoteEvent) {
      eventType = 'NOTE';
      if (notes && notes.length > 0) {
        const eventTime = new Date(event.createdAt).getTime();
        const matchingNote = notes.find(n => {
          if (matchedNoteIds.has(n.id)) return false;
          const noteTime = new Date(n.createdAt).getTime();
          return Math.abs(eventTime - noteTime) <= 15000;
        });

        if (matchingNote) {
          matchedNoteIds.add(matchingNote.id);
          if (!message.includes(matchingNote.content)) {
            message = `${message}:\n${matchingNote.content}`;
          }
        }
      }
    }

    timelineEvents.push({
      ...event,
      message,
      type: eventType,
      sortPriority: 3,
    });
  });

  // Synthesize timeline events for any notes that do not have a matching incidentEvent
  if (notes && notes.length > 0) {
    notes.forEach(note => {
      if (!matchedNoteIds.has(note.id)) {
        const author = note.user?.name || note.user?.email || 'Responder';
        const formattedMsg = note.content.startsWith('📌')
          ? note.content
          : `Note added by ${author}:\n${note.content}`;

        timelineEvents.push({
          id: `note-${note.id}`,
          message: formattedMsg,
          createdAt: note.createdAt,
          type: 'NOTE',
          sortPriority: 3,
        });
      }
    });
  }

  // Sort by date (oldest first for timeline) with secondary ID tie-breaker for same-millisecond events
  timelineEvents.sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (diff !== 0) return diff;
    if (a.sortPriority !== b.sortPriority) {
      return a.sortPriority - b.sortPriority;
    }
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const filteredEvents =
    activeFilter === 'ALL'
      ? timelineEvents
      : timelineEvents.filter(e => categorize(e.type, e.message) === activeFilter);

  const getEventConfig = (type: string) => {
    switch (type) {
      case 'CREATED':
        return {
          variant: 'danger' as const,
          icon: <AlertCircle className="h-4 w-4" />,
          label: 'Created',
          avatarBg: 'bg-red-100',
          avatarText: 'text-red-600',
        };
      case 'ACKNOWLEDGED':
        return {
          variant: 'warning' as const,
          icon: <CheckCircle2 className="h-4 w-4" />,
          label: 'Acknowledged',
          avatarBg: 'bg-amber-100',
          avatarText: 'text-amber-600',
        };
      case 'RESOLVED':
        return {
          variant: 'success' as const,
          icon: <Target className="h-4 w-4" />,
          label: 'Resolved',
          avatarBg: 'bg-green-100',
          avatarText: 'text-green-600',
        };
      case 'NOTE':
      case 'COMMENT':
        return {
          variant: 'info' as const,
          icon: <MessageSquare className="h-4 w-4" />,
          label: 'Note',
          avatarBg: 'bg-blue-100 dark:bg-blue-950/40',
          avatarText: 'text-blue-600 dark:text-blue-400',
        };
      default:
        return {
          variant: 'neutral' as const,
          icon: <Activity className="h-4 w-4" />,
          label: 'Event',
          avatarBg: 'bg-gray-100',
          avatarText: 'text-gray-600',
        };
    }
  };

  if (timelineEvents.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No timeline events yet</h3>
        <p className="text-sm text-muted-foreground">
          Events will appear here as the incident progresses.
        </p>
      </div>
    );
  }

  const filterChips = (
    <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Filter timeline events">
      {FILTERS.map(filter => (
        <button
          key={filter.id}
          type="button"
          onClick={() => setActiveFilter(filter.id)}
          aria-pressed={activeFilter === filter.id}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            activeFilter === filter.id
              ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );

  if (filteredEvents.length === 0) {
    return (
      <div className="space-y-6">
        {filterChips}
        <div className="text-center py-12">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No matching events</h3>
          <p className="text-sm text-muted-foreground">
            Try a different filter, or select &quot;All&quot; to see the full timeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {filterChips}
      <div className="space-y-6 relative ml-2">
        {/* Continuous vertical line background */}
        <div className="absolute left-[19px] top-2 bottom-4 w-px bg-slate-200 dark:bg-slate-700" />
        {filteredEvents.map((event, index) => {
          const config = getEventConfig(event.type);
          const isLifecycleEvent =
            event.type === 'CREATED' || event.type === 'ACKNOWLEDGED' || event.type === 'RESOLVED';
          const isNote = event.type === 'NOTE' || event.type === 'COMMENT';

          return (
            <div
              key={event.id}
              className="relative flex gap-4 group animate-in slide-in-from-left-2 fade-in duration-500 fill-mode-backwards"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Node Icon */}
              <div
                className={`relative z-10 rounded-full border-4 border-white dark:border-slate-900 shrink-0 h-10 w-10 flex items-center justify-center shadow-sm ${config.avatarBg} ${config.avatarText}`}
              >
                {config.icon}
              </div>

              {/* Content Body */}
              <div className="flex-1 pt-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold ${isLifecycleEvent ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                      {config.label}
                    </span>
                    {isLifecycleEvent && (
                      <Badge variant={config.variant} size="xs" className="uppercase h-5">
                        {event.type}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                    {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                  </span>
                </div>

                <p
                  className={`text-sm leading-relaxed whitespace-pre-wrap ${
                    isLifecycleEvent
                      ? 'text-slate-900 dark:text-slate-100 font-medium'
                      : isNote
                        ? 'text-slate-800 dark:text-slate-200'
                        : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {formatEscalationMessage(event.message)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
