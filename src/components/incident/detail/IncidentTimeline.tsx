'use client';

import { useState, useMemo, useEffect } from 'react';
import _TimelineEvent from '../TimelineEvent';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type { AlertActivity } from '@/lib/incidents/alert-activity';
import TimelineGraph, { type GraphMarker, type GraphMarkerKind } from './TimelineGraph';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { loadOlderIncidentTimelineActivity } from './actions';
import { cn } from '@/lib/utils';
import {
  isRunbookEventType,
  runbookEventDisplay,
  type ResponseTone,
} from '@/lib/incidents/response-presentation';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  Target,
  Activity,
  MessageSquare,
  BellRing,
  Loader2,
  Workflow,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import UngroupButton from '../intelligence/UngroupButton';
import {
  INTELLIGENCE_TIMELINE_KIND_LABEL,
  formatOnsetOffset,
  type IntelligenceTimelineEvent,
} from '@/lib/intelligence/incident-ux/timeline-overlay';

type TimelineFilter =
  | 'ALL'
  | 'INTELLIGENCE'
  | 'LIFECYCLE'
  | 'ESCALATION'
  | 'ASSIGNMENT'
  | 'NOTIFICATIONS'
  | 'INTEGRATIONS'
  | 'RUNBOOKS'
  | 'NOTES';

const FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'LIFECYCLE', label: 'Lifecycle' },
  { id: 'ESCALATION', label: 'Escalation' },
  { id: 'ASSIGNMENT', label: 'Assignment' },
  { id: 'NOTIFICATIONS', label: 'Notifications' },
  { id: 'INTEGRATIONS', label: 'Integrations' },
  { id: 'RUNBOOKS', label: 'Runbooks' },
  { id: 'NOTES', label: 'Notes' },
];

// Best-effort categorization from the free-text event message — there's no
// structured "category" field on IncidentEvent, so this is a heuristic filter,
// not an authoritative classification.
export function categorize(type: string, message: string): TimelineFilter {
  if (type === 'INTELLIGENCE') return 'INTELLIGENCE';
  if (type === 'NOTE' || type === 'COMMENT' || type === 'CHAT_MESSAGE') return 'NOTES';
  if (type === 'CREATED' || type === 'ACKNOWLEDGED' || type === 'RESOLVED') return 'LIFECYCLE';
  if (type === 'NOTIFICATION') return 'NOTIFICATIONS';
  if (isRunbookEventType(type)) return 'RUNBOOKS';
  if (type === 'ROLE_ASSIGNED' || type === 'ROLE_UNASSIGNED') return 'ASSIGNMENT';
  if (/\bnote\b|pinned message|comment/i.test(message)) return 'NOTES';
  if (/escalat/i.test(message)) return 'ESCALATION';
  if (/assign|unassigned/i.test(message)) return 'ASSIGNMENT';
  if (/notif|paged?\b|alert sent|sms|call|whatsapp|push|teams/i.test(message))
    return 'NOTIFICATIONS';
  if (/jira|slack|webhook|integration|war.?room/i.test(message)) return 'INTEGRATIONS';
  if (/triggered|created|resolved|acknowledged|snooz|suppress|reopen/i.test(message))
    return 'LIFECYCLE';
  return 'ALL';
}

const CHANGE_LIKE = new Set(['CHANGE', 'METRIC_ANOMALY', 'UPSTREAM_INCIDENT']);

/** Which rows are key events on the activity graph, and how each is drawn. Null: list only. */
function graphMarkerKind(row: {
  type: string;
  message: string;
  intelligence?: IntelligenceTimelineEvent;
}): GraphMarkerKind | null {
  if (row.intelligence) return CHANGE_LIKE.has(row.intelligence.kind) ? 'change' : null;
  if (row.type === 'CREATED') return 'trigger';
  if (row.type === 'ACKNOWLEDGED') return 'ack';
  if (row.type === 'RESOLVED' || row.type === 'MANUAL_RESOLVED' || row.type === 'AUTO_RESOLVED')
    return 'resolved';
  switch (categorize(row.type, row.message)) {
    case 'ESCALATION':
      return 'escalation';
    case 'NOTES':
      return 'note';
    case 'RUNBOOKS':
      return 'runbook';
    case 'LIFECYCLE':
      if (/triggered|created/i.test(row.message)) return 'trigger';
      if (/acknowledged/i.test(row.message)) return 'ack';
      if (/resolved/i.test(row.message)) return 'resolved';
      return 'other';
    default:
      return null;
  }
}

function formatNotificationChannel(channel: string): string {
  switch (channel.toUpperCase()) {
    case 'SMS':
      return 'SMS';
    case 'VOICE':
      return 'Voice call';
    case 'WHATSAPP':
      return 'WhatsApp';
    case 'PUSH':
      return 'Push';
    case 'SLACK':
      return 'Slack';
    case 'MICROSOFT_TEAMS':
      return 'Microsoft Teams';
    case 'EMAIL':
      return 'Email';
    case 'WEBHOOK':
      return 'Webhook';
    default:
      return channel;
  }
}

export type IncidentTimelineNotification = {
  id: string;
  channel: string;
  status: string;
  recipientDisplay?: string | null;
  errorMsg?: string | null;
  createdAt: Date;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  failedAt?: Date | null;
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  } | null;
};

function formatNotificationMessage(notification: IncidentTimelineNotification): string {
  const channel = formatNotificationChannel(notification.channel);
  const target =
    notification.user?.name ||
    notification.user?.email ||
    notification.recipientDisplay ||
    'responder';

  switch (notification.status.toUpperCase()) {
    case 'DELIVERED':
      return `${channel} notification delivered to ${target}`;
    case 'SENT':
      return `${channel} notification sent to ${target}`;
    case 'FAILED':
      return `${channel} notification to ${target} failed${notification.errorMsg ? `: ${notification.errorMsg}` : ''}`;
    case 'SKIPPED':
      return `${channel} notification to ${target} skipped`;
    case 'UNKNOWN':
      return `${channel} notification to ${target} delivery uncertain (provider reconciliation pending)${notification.errorMsg ? `: ${notification.errorMsg}` : ''}`;
    case 'PENDING':
    default:
      return `${channel} notification queued for ${target}`;
  }
}

const RUNBOOK_BADGE_VARIANT: Record<
  ResponseTone,
  'danger' | 'warning' | 'success' | 'info' | 'neutral'
> = {
  critical: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'info',
  oncall: 'info',
  neutral: 'neutral',
};
const RUNBOOK_AVATAR: Record<ResponseTone, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-600 dark:text-rose-400' },
  warning: { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-600 dark:text-amber-400' },
  success: {
    bg: 'bg-emerald-100 dark:bg-emerald-950/40',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  info: { bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-600 dark:text-blue-400' },
  oncall: {
    bg: 'bg-violet-100 dark:bg-violet-950/40',
    text: 'text-violet-600 dark:text-violet-400',
  },
  neutral: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

export type Event = {
  id: string;
  message: string;
  type?: string | null;
  createdAt: Date;
  /** "mcp:<clientId>" when an AI assistant made the change. */
  channel?: string | null;
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
  incidentId?: string;
  events: Event[];
  notes?: Note[];
  notifications?: IncidentTimelineNotification[];
  incidentCreatedAt?: Date;
  incidentAcknowledgedAt?: Date | null;
  incidentResolvedAt?: Date | null;
  totalEventsCount?: number;
  totalNotesCount?: number;
  totalNotificationsCount?: number;
  totalActivityCount?: number;
  /**
   * Intelligence events (noise decisions, changes, upstream incidents, grouping, suggestion and triage
   * decisions, briefings) already filtered to what the viewer may read. Shown as rows of this timeline behind
   * the "Show intelligence events" toggle; absent or empty means the toggle is not rendered at all.
   */
  intelligenceEvents?: IntelligenceTimelineEvent[];
  /** Alerts deduplicated into the incident, for the activity graph above the list. */
  alertActivity?: AlertActivity | null;
  /** When the page was rendered: the graph's right edge while the incident is open. */
  renderedAt?: Date;
};

const EMPTY_NOTES: Note[] = [];
const EMPTY_NOTIFICATIONS: IncidentTimelineNotification[] = [];
const EMPTY_INTELLIGENCE: IntelligenceTimelineEvent[] = [];
const INTELLIGENCE_FILTER = { id: 'INTELLIGENCE' as const, label: 'Intelligence' };

type TimelineRow = {
  id: string;
  message: string;
  createdAt: Date;
  type: string;
  sortPriority: number;
  channel?: string | null;
  intelligence?: IntelligenceTimelineEvent;
};

export default function IncidentTimeline({
  incidentId,
  events,
  notes = EMPTY_NOTES,
  notifications = EMPTY_NOTIFICATIONS,
  incidentCreatedAt,
  incidentAcknowledgedAt,
  incidentResolvedAt,
  totalEventsCount,
  totalNotesCount,
  totalNotificationsCount,
  totalActivityCount,
  intelligenceEvents = EMPTY_INTELLIGENCE,
  alertActivity = null,
  renderedAt,
}: IncidentTimelineProps) {
  const { userTimeZone } = useTimezone();
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>('ALL');
  // On by default whenever there is something to show; the toggle itself is absent otherwise.
  const [showIntelligence, setShowIntelligence] = useState(true);
  const hasIntelligence = intelligenceEvents.length > 0;
  const [loadedEvents, setLoadedEvents] = useState<Event[]>(events);
  const [loadedNotes, setLoadedNotes] = useState<Note[]>(notes);
  const [loadedNotifications, setLoadedNotifications] =
    useState<IncidentTimelineNotification[]>(notifications);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasExhaustedOlder, setHasExhaustedOlder] = useState(false);

  useEffect(() => {
    // Server props replace the locally paginated list when the incident data refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadedEvents(prev => {
      if (prev === events) return prev;
      if (prev.length === 0 && events.length === 0) return prev;
      return events;
    });
  }, [events]);

  useEffect(() => {
    // Server props replace the locally paginated list when the incident data refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadedNotes(prev => {
      if (prev === notes) return prev;
      if (prev.length === 0 && notes.length === 0) return prev;
      return notes;
    });
  }, [notes]);

  useEffect(() => {
    // Server props replace the locally paginated list when the incident data refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadedNotifications(prev => {
      if (prev === notifications) return prev;
      if (prev.length === 0 && notifications.length === 0) return prev;
      return notifications;
    });
  }, [notifications]);

  const totalItemsCount =
    totalActivityCount ??
    (totalEventsCount ?? 0) + (totalNotesCount ?? 0) + (totalNotificationsCount ?? 0);
  const currentItemsCount = loadedEvents.length + loadedNotes.length + loadedNotifications.length;
  const hasMoreActivity =
    Boolean(incidentId) &&
    !hasExhaustedOlder &&
    (totalItemsCount > 0 ? totalItemsCount > currentItemsCount : false);

  const handleLoadOlderActivity = async () => {
    if (!incidentId || isLoadingMore || currentItemsCount === 0) return;

    let oldestEventDate: Date | null = null;
    let oldestEventId: string | null = null;
    for (const e of loadedEvents) {
      const d = new Date(e.createdAt);
      if (
        !oldestEventDate ||
        d.getTime() < oldestEventDate.getTime() ||
        (d.getTime() === oldestEventDate.getTime() && (!oldestEventId || e.id < oldestEventId))
      ) {
        oldestEventDate = d;
        oldestEventId = e.id;
      }
    }

    let oldestNoteDate: Date | null = null;
    let oldestNoteId: string | null = null;
    for (const n of loadedNotes) {
      const d = new Date(n.createdAt);
      if (
        !oldestNoteDate ||
        d.getTime() < oldestNoteDate.getTime() ||
        (d.getTime() === oldestNoteDate.getTime() && (!oldestNoteId || n.id < oldestNoteId))
      ) {
        oldestNoteDate = d;
        oldestNoteId = n.id;
      }
    }

    let oldestNotifDate: Date | null = null;
    let oldestNotifId: string | null = null;
    for (const notif of loadedNotifications) {
      const d = new Date(notif.createdAt);
      if (
        !oldestNotifDate ||
        d.getTime() < oldestNotifDate.getTime() ||
        (d.getTime() === oldestNotifDate.getTime() && (!oldestNotifId || notif.id < oldestNotifId))
      ) {
        oldestNotifDate = d;
        oldestNotifId = notif.id;
      }
    }

    if (!oldestEventDate && !oldestNoteDate && !oldestNotifDate) return;

    setIsLoadingMore(true);
    try {
      const older = await loadOlderIncidentTimelineActivity(incidentId, {
        eventCursor:
          oldestEventDate && oldestEventId
            ? { createdAt: oldestEventDate.toISOString(), id: oldestEventId }
            : undefined,
        noteCursor:
          oldestNoteDate && oldestNoteId
            ? { createdAt: oldestNoteDate.toISOString(), id: oldestNoteId }
            : undefined,
        notificationCursor:
          oldestNotifDate && oldestNotifId
            ? { createdAt: oldestNotifDate.toISOString(), id: oldestNotifId }
            : undefined,
      });

      if (
        older.events.length === 0 &&
        older.notes.length === 0 &&
        older.notifications.length === 0
      ) {
        setHasExhaustedOlder(true);
      } else {
        if (older.events.length > 0) {
          setLoadedEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newEvents = older.events
              .filter(e => !existingIds.has(e.id))
              .map(e => ({ ...e, createdAt: new Date(e.createdAt) }));
            return [...prev, ...newEvents];
          });
        }
        if (older.notes.length > 0) {
          setLoadedNotes(prev => {
            const existingIds = new Set(prev.map(n => n.id));
            const newNotes = older.notes
              .filter(n => !existingIds.has(n.id))
              .map(n => ({ ...n, createdAt: new Date(n.createdAt) }));
            return [...prev, ...newNotes];
          });
        }
        if (older.notifications.length > 0) {
          setLoadedNotifications(prev => {
            const existingIds = new Set(prev.map(notif => notif.id));
            const newNotifs = older.notifications
              .filter(notif => !existingIds.has(notif.id))
              .map(notif => ({
                ...notif,
                createdAt: new Date(notif.createdAt),
                sentAt: notif.sentAt ? new Date(notif.sentAt) : null,
                deliveredAt: notif.deliveredAt ? new Date(notif.deliveredAt) : null,
                failedAt: notif.failedAt ? new Date(notif.failedAt) : null,
              }));
            return [...prev, ...newNotifs];
          });
        }
      }
    } catch (err) {
      console.error('Failed to load older activity', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

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
  const timelineEvents = useMemo(() => {
    const eventsList: TimelineRow[] = [];

    if (showIntelligence) {
      for (const item of intelligenceEvents) {
        eventsList.push({
          id: item.id,
          message: item.title,
          createdAt: item.at,
          type: 'INTELLIGENCE',
          sortPriority: 4,
          intelligence: item,
        });
      }
    }

    let hasCreatedDbEvent = false;
    let hasAckDbEvent = false;
    let hasResolveDbEvent = false;

    for (const e of loadedEvents) {
      if (!hasCreatedDbEvent && /triggered|created/i.test(e.message)) hasCreatedDbEvent = true;
      if (!hasAckDbEvent && /acknowledged/i.test(e.message)) hasAckDbEvent = true;
      if (!hasResolveDbEvent && /resolved/i.test(e.message)) hasResolveDbEvent = true;
    }

    // Add incident creation
    if (incidentCreatedAt && !hasCreatedDbEvent) {
      eventsList.push({
        id: 'incident-created',
        message: 'Incident triggered and created',
        createdAt: incidentCreatedAt,
        type: 'CREATED',
        sortPriority: 0,
      });
    }

    // Add acknowledgment
    if (incidentAcknowledgedAt && !hasAckDbEvent) {
      eventsList.push({
        id: 'incident-acknowledged',
        message: 'Incident acknowledged by responder',
        createdAt: incidentAcknowledgedAt,
        type: 'ACKNOWLEDGED',
        sortPriority: 1,
      });
    }

    // Add resolution
    if (incidentResolvedAt && !hasResolveDbEvent) {
      eventsList.push({
        id: 'incident-resolved',
        message: 'Incident marked as resolved',
        createdAt: incidentResolvedAt,
        type: 'RESOLVED',
        sortPriority: 2,
      });
    }

    // Track matched notes to prevent duplicates when an incidentEvent already exists for a note
    const matchedNoteIds = new Set<string>();
    const noteLookup = (loadedNotes || []).map(n => ({
      id: n.id,
      content: n.content,
      time: new Date(n.createdAt).getTime(),
    }));

    // Add regular events
    loadedEvents.forEach(event => {
      const isNoteEvent =
        event.type !== 'CHAT_MESSAGE' &&
        (event.type === 'NOTE' ||
          event.type === 'COMMENT' ||
          /\bnote\b|pinned message|comment/i.test(event.message));

      let message = event.message;
      let eventType = event.type || 'EVENT';

      if (isNoteEvent) {
        eventType = 'NOTE';
        if (noteLookup.length > 0) {
          const eventTime = new Date(event.createdAt).getTime();
          const matchingNote = noteLookup.find(
            n => !matchedNoteIds.has(n.id) && Math.abs(eventTime - n.time) <= 15000
          );

          if (matchingNote) {
            matchedNoteIds.add(matchingNote.id);
            if (!message.includes(matchingNote.content)) {
              message = `${message}:\n${matchingNote.content}`;
            }
          }
        }
      }

      eventsList.push({
        ...event,
        message,
        type: eventType,
        sortPriority: 3,
      });
    });

    // Synthesize timeline events for any notes that do not have a matching incidentEvent
    if (loadedNotes && loadedNotes.length > 0) {
      loadedNotes.forEach(note => {
        if (!matchedNoteIds.has(note.id)) {
          const author = note.user?.name || note.user?.email || 'Responder';
          const formattedMsg = note.content.startsWith('📌')
            ? note.content
            : `Note added by ${author}:\n${note.content}`;

          eventsList.push({
            id: `note-${note.id}`,
            message: formattedMsg,
            createdAt: note.createdAt,
            type: 'NOTE',
            sortPriority: 3,
          });
        }
      });
    }

    // Track matched voice call events to deduplicate synthesized voice deliveries
    const matchedVoiceEventIds = new Set<string>();
    const voiceEvents = loadedEvents
      .filter(e => /voice call connected/i.test(e.message))
      .map(e => ({
        id: e.id,
        time: new Date(e.createdAt).getTime(),
        msgLower: e.message.toLowerCase(),
      }));

    // Synthesize timeline events for incident notifications
    if (loadedNotifications && loadedNotifications.length > 0) {
      loadedNotifications.forEach(notif => {
        let timestamp: string | Date | undefined;
        switch (notif.status) {
          case 'FAILED':
          case 'UNKNOWN':
            timestamp = notif.failedAt || notif.sentAt || notif.createdAt;
            break;
          case 'DELIVERED':
            timestamp = notif.deliveredAt || notif.sentAt || notif.createdAt;
            break;
          case 'SENT':
            timestamp = notif.sentAt || notif.deliveredAt || notif.createdAt;
            break;
          default:
            timestamp = notif.deliveredAt || notif.failedAt || notif.sentAt || notif.createdAt;
            break;
        }

        // Suppress synthesized entry when an equivalent persisted voice call connected event exists for this responder
        if (
          notif.channel?.toUpperCase() === 'VOICE' &&
          notif.status?.toUpperCase() === 'DELIVERED'
        ) {
          const notifTime = timestamp ? new Date(timestamp).getTime() : 0;
          const recipientName = notif.user?.name?.trim().toLowerCase();
          const recipientEmail = notif.user?.email?.trim().toLowerCase();
          const recipientPhone = notif.recipientDisplay?.trim().toLowerCase();

          const matchingEvent = voiceEvents.find(e => {
            if (matchedVoiceEventIds.has(e.id)) return false;
            if (Math.abs(e.time - notifTime) > 120_000) return false;

            if (recipientName && e.msgLower.includes(recipientName)) return true;
            if (recipientEmail && e.msgLower.includes(recipientEmail)) return true;
            if (recipientPhone && e.msgLower.includes(recipientPhone)) return true;
            if (
              !recipientName &&
              !recipientEmail &&
              !recipientPhone &&
              e.msgLower.includes('responder')
            ) {
              return true;
            }
            return false;
          });
          if (matchingEvent) {
            matchedVoiceEventIds.add(matchingEvent.id);
            return;
          }
        }

        eventsList.push({
          id: `notif-${notif.id}`,
          message: formatNotificationMessage(notif),
          createdAt: timestamp ? new Date(timestamp) : new Date(),
          type: 'NOTIFICATION',
          sortPriority: 3,
        });
      });
    }

    // Sort by date (oldest first for timeline) with secondary ID tie-breaker for same-millisecond events
    eventsList.sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (diff !== 0) return diff;
      if (a.sortPriority !== b.sortPriority) {
        return a.sortPriority - b.sortPriority;
      }
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return eventsList;
  }, [
    loadedEvents,
    loadedNotes,
    loadedNotifications,
    incidentCreatedAt,
    incidentAcknowledgedAt,
    incidentResolvedAt,
    intelligenceEvents,
    showIntelligence,
  ]);

  // Hiding intelligence events while their filter is selected would leave an empty, confusing list.
  if (activeFilter === 'INTELLIGENCE' && (!hasIntelligence || !showIntelligence)) {
    setActiveFilter('ALL');
  }

  const filteredEvents = useMemo(() => {
    return activeFilter === 'ALL'
      ? timelineEvents
      : timelineEvents.filter(e => categorize(e.type, e.message) === activeFilter);
  }, [timelineEvents, activeFilter]);

  // Key events for the activity graph: what changed the incident's course, not every page sent.
  const graphMarkers = useMemo(
    () =>
      timelineEvents.flatMap((row): GraphMarker[] => {
        const kind = graphMarkerKind(row);
        if (!kind) return [];
        const label = row.message.split('\n')[0].slice(0, 140);
        return [{ id: row.id, at: new Date(row.createdAt), kind, label }];
      }),
    [timelineEvents]
  );

  const jumpToRow = (rowId: string) => {
    setActiveFilter('ALL');
    // After the "All" list renders, the row is the hash target: it scrolls into view and highlights.
    requestAnimationFrame(() => {
      const hash = `#timeline-${rowId}`;
      if (window.location.hash === hash)
        document.getElementById(`timeline-${rowId}`)?.scrollIntoView({ block: 'center' });
      else window.location.hash = hash;
    });
  };

  // Consecutive alert rows fold into one "N alerts" row: the activity graph already plots each arrival.
  const { alertRuns, alertRunSkip } = useMemo(() => {
    const runs = new Map<string, TimelineRow[]>();
    const skip = new Set<string>();
    let current: TimelineRow[] = [];
    const flush = () => {
      if (current.length > 1) {
        runs.set(current[0].id, current);
        for (const row of current.slice(1)) skip.add(row.id);
      }
      current = [];
    };
    for (const row of filteredEvents) {
      if (row.intelligence?.kind === 'ALERT') current.push(row);
      else flush();
    }
    flush();
    return { alertRuns: runs, alertRunSkip: skip };
  }, [filteredEvents]);

  const filterCounts = useMemo(() => {
    const counts: Record<TimelineFilter, number> = {
      ALL: timelineEvents.length,
      INTELLIGENCE: 0,
      LIFECYCLE: 0,
      ESCALATION: 0,
      ASSIGNMENT: 0,
      NOTIFICATIONS: 0,
      INTEGRATIONS: 0,
      RUNBOOKS: 0,
      NOTES: 0,
    };
    for (const e of timelineEvents) {
      const cat = categorize(e.type, e.message);
      if (cat in counts) {
        counts[cat as keyof typeof counts]++;
      }
    }
    return counts;
  }, [timelineEvents]);

  const getEventConfig = (type: string, message: string) => {
    switch (type) {
      case 'INTELLIGENCE':
        return {
          variant: 'info' as const,
          icon: <Sparkles className="h-4 w-4" />,
          label: 'Intelligence',
          avatarBg: 'bg-status-shift-soft dark:bg-status-shift/20',
          avatarText: 'text-status-shift-deep dark:text-status-shift',
        };
      case 'CREATED':
        return {
          variant: 'danger' as const,
          icon: <AlertCircle className="h-4 w-4" />,
          label: 'Created',
          avatarBg: 'bg-rose-100',
          avatarText: 'text-rose-600',
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
          avatarBg: 'bg-emerald-100',
          avatarText: 'text-emerald-600',
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
      case 'CHAT_MESSAGE':
        return {
          variant: 'info' as const,
          icon: <MessageSquare className="h-4 w-4" />,
          label: 'War room',
          avatarBg: 'bg-blue-100 dark:bg-blue-950/40',
          avatarText: 'text-blue-600 dark:text-blue-400',
        };
      case 'NOTIFICATION':
        return {
          variant: 'info' as const,
          icon: <BellRing className="h-4 w-4" />,
          label: 'Notification',
          avatarBg: 'bg-purple-100 dark:bg-purple-950/40',
          avatarText: 'text-purple-600 dark:text-purple-400',
        };
      default:
        if (isRunbookEventType(type)) {
          const presentation = runbookEventDisplay(type, message);
          return {
            variant: RUNBOOK_BADGE_VARIANT[presentation.tone],
            icon: <Workflow className="h-4 w-4" />,
            label: presentation.label,
            avatarBg: RUNBOOK_AVATAR[presentation.tone].bg,
            avatarText: RUNBOOK_AVATAR[presentation.tone].text,
          };
        }
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

  const activityGraph = incidentCreatedAt ? (
    <TimelineGraph
      alerts={alertActivity}
      markers={graphMarkers}
      onsetAt={incidentCreatedAt}
      endAt={incidentResolvedAt ?? renderedAt ?? incidentCreatedAt}
      open={!incidentResolvedAt}
      timeZone={userTimeZone}
      onJump={jumpToRow}
    />
  ) : null;

  const visibleFilters =
    hasIntelligence && showIntelligence
      ? [FILTERS[0], INTELLIGENCE_FILTER, ...FILTERS.slice(1)]
      : FILTERS;

  // One row: the filters that have something in them, then the intelligence switch at its end.
  const intelligenceToggle = hasIntelligence ? (
    <label
      id="timeline-intelligence"
      className="inline-flex h-6.5 scroll-mt-24 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border/80 px-2 text-xs font-medium text-muted-foreground transition-colors select-none hover:text-foreground has-checked:border-solid has-checked:text-foreground"
    >
      <input
        type="checkbox"
        checked={showIntelligence}
        onChange={event => setShowIntelligence(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-border accent-primary"
      />
      Show intelligence events
      <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {intelligenceEvents.length}
      </span>
    </label>
  ) : null;

  const filterChips = (
    <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Filter timeline events">
      {visibleFilters
        .filter(f => f.id === 'ALL' || f.id === activeFilter || (filterCounts[f.id] ?? 0) > 0)
        .map(filter => {
          const count = filterCounts[filter.id] ?? 0;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
              aria-pressed={activeFilter === filter.id}
              aria-label={filter.label}
              className={cn(
                'h-6.5 px-2.5 rounded-md text-xs font-medium transition-all select-none border focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring flex items-center gap-1.5',
                activeFilter === filter.id
                  ? 'bg-foreground text-background border-foreground shadow-2xs font-semibold'
                  : 'bg-background text-muted-foreground border-border/80 hover:text-foreground hover:bg-muted/40'
              )}
            >
              <span>{filter.label}</span>
              <span
                className={cn(
                  'text-[10.5px] tabular-nums font-mono',
                  activeFilter === filter.id
                    ? 'opacity-90 font-semibold'
                    : 'text-muted-foreground/70'
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      {intelligenceToggle}
    </div>
  );

  if (filteredEvents.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          {activityGraph}
          {filterChips}
        </div>
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
    <div className="space-y-5">
      <div>
        {activityGraph}
        {filterChips}
      </div>
      <div className="space-y-4 relative ml-1">
        {/* Continuous vertical line background */}
        <div className="absolute left-[15px] top-2 bottom-4 w-px bg-border/70" />
        {filteredEvents.map((event, index) => {
          if (alertRunSkip.has(event.id)) return null;
          const run = alertRuns.get(event.id);
          if (run) {
            const runConfig = getEventConfig(event.type, event.message);
            const first = run[0];
            const last = run[run.length - 1];
            return (
              <details
                key={event.id}
                id={`timeline-${event.id}`}
                className="group/run relative scroll-mt-24 target:rounded-lg target:bg-amber-50/60 dark:target:bg-amber-950/20"
              >
                <summary className="flex cursor-pointer list-none gap-3 [&::-webkit-details-marker]:hidden">
                  <div
                    className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-background shadow-2xs ${runConfig.avatarBg} ${runConfig.avatarText}`}
                  >
                    {runConfig.icon}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pt-1">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-foreground">{run.length} alerts</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · deduplicated into this incident ·{' '}
                        {formatDateTime(first.createdAt, userTimeZone, { format: 'time' })}–
                        {formatDateTime(last.createdAt, userTimeZone, { format: 'time' })}
                      </span>
                    </span>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/run:rotate-180"
                      aria-hidden
                    />
                  </div>
                </summary>
                <ul className="mt-2 ml-11 space-y-1 border-l border-border/70 pl-3 text-xs">
                  {run.map(alert => (
                    <li key={alert.id} className="flex gap-2">
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        {formatDateTime(alert.createdAt, userTimeZone, { format: 'time' })}
                      </span>
                      <span className="min-w-0 text-foreground/90">
                        {alert.intelligence?.detail ?? alert.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          }
          const config = getEventConfig(event.type, event.message);
          const isLifecycleEvent =
            event.type === 'CREATED' || event.type === 'ACKNOWLEDGED' || event.type === 'RESOLVED';
          const isNote = event.type === 'NOTE' || event.type === 'COMMENT';
          const intel = event.intelligence;

          if (intel) {
            const titleClass = 'font-medium text-slate-800 hover:underline dark:text-slate-200';
            return (
              <div
                key={event.id}
                id={`timeline-${event.id}`}
                data-intelligence-kind={intel.kind}
                className="relative flex scroll-mt-24 gap-4 group target:rounded-lg target:bg-amber-50/60 dark:target:bg-amber-950/20"
              >
                <div
                  className={`relative z-10 rounded-full border-2 border-background shrink-0 h-8 w-8 flex items-center justify-center shadow-2xs ${config.avatarBg} ${config.avatarText}`}
                >
                  {config.icon}
                </div>
                <div className="flex-1 pt-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-semibold text-foreground/90">
                        {INTELLIGENCE_TIMELINE_KIND_LABEL[intel.kind]}
                      </span>
                      <Badge variant="info" size="xs" className="uppercase h-5 text-[10px]">
                        Intelligence
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                        {!intel.href ? (
                          <span className="font-medium">{intel.title}</span>
                        ) : intel.insightsSection ? (
                          <a
                            href={intel.href}
                            data-insights-open={intel.insightsSection}
                            className={titleClass}
                          >
                            {intel.title}
                          </a>
                        ) : intel.href.startsWith('/') ? (
                          <Link href={intel.href} className={titleClass}>
                            {intel.title}
                          </Link>
                        ) : (
                          <a
                            href={intel.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={titleClass}
                          >
                            {intel.title}
                          </a>
                        )}
                        {intel.riskPercent !== undefined && intel.riskPercent !== null && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-foreground">
                            risk {intel.riskPercent}%
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatOnsetOffset(intel.offsetMinutes)}
                        {intel.detail ? ` · ${intel.detail}` : ''}
                      </p>
                      {intel.why && intel.why.length > 0 && (
                        <details className="text-xs">
                          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8">
                            Why?
                          </summary>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground/80">
                            {intel.why.map((line, lineIndex) => (
                              <li key={lineIndex}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                    {incidentId && (intel.reversal || intel.reversed) && (
                      // Stays mounted once reversed so the result survives the refresh the action triggers.
                      <UngroupButton
                        incidentId={incidentId}
                        target={{ type: 'decision', decisionId: intel.reversal?.decisionId ?? '' }}
                        settled={!intel.reversal}
                        label={intel.reversal?.pages ? 'Reverse and page' : 'Mark wrong'}
                        confirmTitle={
                          intel.reversal?.pages
                            ? 'Reverse this decision and page?'
                            : 'Mark this decision wrong?'
                        }
                        confirmBody={
                          intel.reversal?.pages
                            ? 'The alert is re-ingested as its own incident and pages normally. The decision is recorded as wrong, which counts against the rule in noise-control reports.'
                            : 'Nothing pages: the decision only changed how the alert was handled. It is recorded as wrong, which counts against the rule in noise-control reports.'
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={event.id}
              id={`timeline-${event.id}`}
              className="relative flex scroll-mt-24 gap-4 group animate-in slide-in-from-left-2 fade-in duration-500 fill-mode-backwards target:rounded-lg target:bg-amber-50/60 dark:target:bg-amber-950/20"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Node Icon */}
              <div
                className={`relative z-10 rounded-full border-2 border-background shrink-0 h-8 w-8 flex items-center justify-center shadow-2xs ${config.avatarBg} ${config.avatarText}`}
              >
                {config.icon}
              </div>

              {/* Content Body */}
              <div className="flex-1 pt-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs sm:text-sm font-semibold ${isLifecycleEvent ? 'text-foreground' : 'text-foreground/90'}`}
                    >
                      {config.label}
                    </span>
                    {isLifecycleEvent && (
                      <Badge
                        variant={config.variant}
                        size="xs"
                        className="uppercase h-5 text-[10px]"
                      >
                        {event.type}
                      </Badge>
                    )}
                    {event.channel?.startsWith('mcp:') && (
                      <Badge
                        variant="outline"
                        size="xs"
                        className="h-5 text-[10px]"
                        title="Made through an AI assistant on this person's behalf"
                      >
                        AI assistant
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                    {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                  </span>
                </div>

                <p
                  className={`text-sm leading-relaxed whitespace-pre-wrap ${
                    isLifecycleEvent
                      ? 'text-slate-900 dark:text-zinc-100 font-medium'
                      : isNote
                        ? 'text-slate-800 dark:text-zinc-200'
                        : 'text-slate-600 dark:text-zinc-400'
                  }`}
                >
                  {formatEscalationMessage(event.message)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {hasMoreActivity && (
        <div className="mt-4 flex flex-col items-center justify-center p-3 border rounded-lg bg-slate-50 dark:bg-zinc-800/40 text-xs text-muted-foreground gap-2">
          <span>
            Showing {currentItemsCount} of {totalItemsCount} activity items
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadOlderActivity}
            disabled={isLoadingMore}
            className="h-8 gap-1.5"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading older activity...</span>
              </>
            ) : (
              <span>Load older activity</span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
