'use client';

import type { TimelineEvent } from './PostmortemTimelineBuilder';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';
import { Search, Megaphone, Wrench, CheckCircle2 } from 'lucide-react';
import { TIMELINE_EVENT_TYPE_CONFIG } from './shared';
export type { TimelineEvent };

interface PostmortemTimelineProps {
  events: TimelineEvent[];
  incidentStartTime?: Date;
  incidentEndTime?: Date;
}

export default function PostmortemTimeline({
  events,
  incidentStartTime,
  incidentEndTime,
}: PostmortemTimelineProps) {
  const { userTimeZone } = useTimezone();

  if (!events || events.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-white to-slate-50">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No timeline events recorded</p>
        </CardContent>
      </Card>
    );
  }

  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const startTime = incidentStartTime || new Date(sortedEvents[0].timestamp);
  const endTime = incidentEndTime || new Date(sortedEvents[sortedEvents.length - 1].timestamp);
  const totalDuration = endTime.getTime() - startTime.getTime();

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
      <CardHeader>
        <CardTitle className="text-xl">Incident Timeline</CardTitle>
        <p className="text-sm text-muted-foreground">
          Total duration: {formatDuration(totalDuration)}
        </p>
      </CardHeader>
      <CardContent>
        <div className="relative pl-6">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 to-green-500 rounded" />

          {sortedEvents.map((event, index) => {
            const eventTime = new Date(event.timestamp);
            const config =
              TIMELINE_EVENT_TYPE_CONFIG[event.type as keyof typeof TIMELINE_EVENT_TYPE_CONFIG] ||
              TIMELINE_EVENT_TYPE_CONFIG.DETECTION;
            const EventIcon = config.Icon;

            return (
              <div
                key={event.id}
                className={cn('relative', index < sortedEvents.length - 1 && 'mb-6')}
              >
                {/* Event marker */}
                <div
                  className={cn(
                    'absolute -left-[1.75rem] top-2 w-8 h-8 rounded-full flex items-center justify-center z-10',
                    'border-[3px] border-white shadow-md',
                    config.solidBg
                  )}
                >
                  <EventIcon className="w-4 h-4 text-white" />
                </div>

                {/* Event card */}
                <div
                  className={cn(
                    'ml-4 p-4 bg-white rounded-md shadow-sm',
                    'border-2',
                    config.border
                  )}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-semibold',
                          config.bg,
                          config.color
                        )}
                      >
                        {config.label}
                      </span>
                      {index > 0 && (
                        <span className="text-xs text-muted-foreground">
                          +
                          {formatDuration(
                            eventTime.getTime() -
                              new Date(sortedEvents[index - 1].timestamp).getTime()
                          )}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground font-medium">
                      {formatDateTime(eventTime, userTimeZone, { format: 'datetime' })}
                    </span>
                  </div>
                  <h4 className="text-base font-semibold mb-1 text-foreground">{event.title}</h4>
                  {event.description && (
                    <p className="text-sm text-muted-foreground leading-relaxed mb-1">
                      {event.description}
                    </p>
                  )}
                  {event.actor && (
                    <p className="text-xs text-muted-foreground italic">👤 {event.actor}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
