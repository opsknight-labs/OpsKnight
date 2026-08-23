'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { TIMELINE_EVENT_TYPE_CONFIG } from './shared';

export type TimelineEvent = {
  id: string;
  timestamp: string; // ISO string
  type: 'DETECTION' | 'ESCALATION' | 'MITIGATION' | 'RESOLUTION';
  title: string;
  description: string;
  actor?: string;
};

interface PostmortemTimelineBuilderProps {
  events: TimelineEvent[];
  onChange: (events: TimelineEvent[]) => void;
}

const toLocalInputValue = (isoStr: string) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

const fromLocalInputValue = (localStr: string) => {
  if (!localStr) return new Date().toISOString();
  const d = new Date(localStr);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

const sortEvents = (items: TimelineEvent[]) => {
  return [...items].sort((a, b) => {
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (diff !== 0) return diff;
    return (a.id || '').localeCompare(b.id || '');
  });
};

export default function PostmortemTimelineBuilder({
  events,
  onChange,
}: PostmortemTimelineBuilderProps) {
  const { userTimeZone } = useTimezone();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState<Partial<TimelineEvent>>({
    type: 'DETECTION',
    timestamp: toLocalInputValue(new Date().toISOString()),
  });

  const addEvent = () => {
    if (!newEvent.title || !newEvent.timestamp) return;

    const event: TimelineEvent = {
      id: `event-${Date.now()}`,
      timestamp: fromLocalInputValue(newEvent.timestamp),
      type: newEvent.type || 'DETECTION',
      title: newEvent.title,
      description: newEvent.description || '',
      actor: newEvent.actor,
    };

    const updated = sortEvents([...events, event]);
    onChange(updated);
    setNewEvent({
      type: 'DETECTION',
      timestamp: toLocalInputValue(new Date().toISOString()),
    });
  };

  const updateEvent = (id: string, updates: Partial<TimelineEvent>) => {
    const updated = events.map(e => (e.id === id ? { ...e, ...updates } : e));
    onChange(sortEvents(updated));
  };

  const deleteEvent = (id: string) => {
    onChange(events.filter(e => e.id !== id));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Add New Event Form */}
      <Card className="bg-gradient-to-br from-white to-slate-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Add Timeline Event</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Event Type</Label>
              <Select
                value={newEvent.type || 'DETECTION'}
                onValueChange={value =>
                  setNewEvent({ ...newEvent, type: value as TimelineEvent['type'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIMELINE_EVENT_TYPE_CONFIG).map(([value, config]) => (
                    <SelectItem key={value} value={value}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Timestamp</Label>
              <Input
                type="datetime-local"
                value={newEvent.timestamp || ''}
                onChange={e => setNewEvent({ ...newEvent, timestamp: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              placeholder="e.g., Incident detected by monitoring system"
              value={newEvent.title || ''}
              onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              rows={3}
              placeholder="Detailed description of what happened..."
              value={newEvent.description || ''}
              onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Actor (Optional)</Label>
            <Input
              placeholder="Who or what triggered this event?"
              value={newEvent.actor || ''}
              onChange={e => setNewEvent({ ...newEvent, actor: e.target.value })}
            />
          </div>
          <Button
            onClick={addEvent}
            disabled={!newEvent.title || !newEvent.timestamp}
            className="w-fit"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Event
          </Button>
        </CardContent>
      </Card>

      {/* Events List */}
      {events.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold mb-2">Timeline Events ({events.length})</h3>
          {events.map(event => {
            const config =
              TIMELINE_EVENT_TYPE_CONFIG[event.type as keyof typeof TIMELINE_EVENT_TYPE_CONFIG] ||
              TIMELINE_EVENT_TYPE_CONFIG.DETECTION;
            return (
              <Card key={event.id} className={cn('bg-white border-l-4', config.border)}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold',
                            config.bg,
                            config.color
                          )}
                        >
                          {config.label}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {formatDateTime(event.timestamp, userTimeZone, { format: 'datetime' })}
                        </span>
                      </div>
                      <h4 className="text-base font-semibold mb-1">{event.title}</h4>
                      {event.description && (
                        <p className="text-sm text-muted-foreground mb-1">{event.description}</p>
                      )}
                      {event.actor && (
                        <p className="text-xs text-muted-foreground">Actor: {event.actor}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingId(editingId === event.id ? null : event.id)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => deleteEvent(event.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Edit Form */}
                  {editingId === event.id && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-md flex flex-col gap-2">
                      <div className="space-y-1.5">
                        <Label>Type</Label>
                        <Select
                          value={event.type}
                          onValueChange={value =>
                            updateEvent(event.id, { type: value as TimelineEvent['type'] })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(TIMELINE_EVENT_TYPE_CONFIG).map(([value, cfg]) => (
                              <SelectItem key={value} value={value}>
                                {cfg.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Timestamp</Label>
                        <Input
                          type="datetime-local"
                          value={toLocalInputValue(event.timestamp)}
                          onChange={e =>
                            updateEvent(event.id, {
                              timestamp: fromLocalInputValue(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Title</Label>
                        <Input
                          value={event.title}
                          onChange={e => updateEvent(event.id, { title: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Textarea
                          rows={2}
                          value={event.description}
                          onChange={e => updateEvent(event.id, { description: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Actor</Label>
                        <Input
                          value={event.actor || ''}
                          onChange={e => updateEvent(event.id, { actor: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
