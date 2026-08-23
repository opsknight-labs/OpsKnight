'use client';

import _TimelineEvent from '../TimelineEvent';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Clock, AlertCircle, CheckCircle2, Target, Activity, Plus, ArrowRight } from 'lucide-react';

type Event = {
  id: string;
  message: string;
  createdAt: Date;
};

type IncidentTimelineProps = {
  events: Event[];
  incidentCreatedAt?: Date;
  incidentAcknowledgedAt?: Date | null;
  incidentResolvedAt?: Date | null;
};

export default function IncidentTimeline({
  events,
  incidentCreatedAt,
  incidentAcknowledgedAt,
  incidentResolvedAt,
}: IncidentTimelineProps) {
  const { userTimeZone } = useTimezone();

  const formatEscalationMessage = (message: string) => {
    return message.replace(/\[\[scheduledAt=([^\]]+)\]\]/g, (_match, scheduledAtRaw) => {
      const scheduledAt = new Date(scheduledAtRaw);
      if (Number.isNaN(scheduledAt.getTime())) {
        return scheduledAtRaw;
      }
      return formatDateTime(scheduledAt, userTimeZone, { format: 'datetime' });
    });
  };

  // Create a comprehensive timeline with incident lifecycle events
  const timelineEvents: Array<{
    id: string;
    message: string;
    createdAt: Date;
    type: 'CREATED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EVENT';
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

  // Add regular events
  events.forEach(event => {
    timelineEvents.push({
      ...event,
      type: 'EVENT',
      sortPriority: 3,
    });
  });

  // Sort by date (oldest first for timeline) with secondary ID tie-breaker for same-millisecond events
  timelineEvents.sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (diff !== 0) return diff;
    if (a.sortPriority !== b.sortPriority) {
      return a.sortPriority - b.sortPriority;
    }
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

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

  return (
    <div className="space-y-6 relative ml-2">
      {/* Continuous vertical line background */}
      <div className="absolute left-[19px] top-2 bottom-4 w-px bg-slate-200" />
      {timelineEvents.map((event, index) => {
        const config = getEventConfig(event.type);
        const isMajorEvent = event.type !== 'EVENT';

        return (
          <div
            key={event.id}
            className="relative flex gap-4 group animate-in slide-in-from-left-2 fade-in duration-500 fill-mode-backwards"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {/* Node Icon */}
            <div
              className={`relative z-10 rounded-full border-4 border-white shrink-0 h-10 w-10 flex items-center justify-center shadow-sm ${config.avatarBg} ${config.avatarText}`}
            >
              {config.icon}
            </div>

            {/* Content Body */}
            <div className="flex-1 pt-1.5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${isMajorEvent ? 'text-slate-900' : 'text-slate-700'}`}
                  >
                    {config.label}
                  </span>
                  {isMajorEvent && (
                    <Badge variant={config.variant} size="xs" className="uppercase h-5">
                      {event.type}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-slate-400 tabular-nums">
                  {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                </span>
              </div>

              <p
                className={`text-sm leading-relaxed whitespace-pre-wrap ${isMajorEvent ? 'text-slate-900 font-medium' : 'text-slate-600'}`}
              >
                {formatEscalationMessage(event.message)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
