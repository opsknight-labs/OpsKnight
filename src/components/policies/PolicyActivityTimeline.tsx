'use client';

import React from 'react';
import ActivityTimeline, { type ActivityTimelineItem } from '@/components/ui/ActivityTimeline';

export type PolicyActivityLog = {
  id: string;
  action: string;
  createdAt: Date | string;
  actor?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  actorName?: string | null;
  actorEmail?: string | null;
  details?: unknown;
  [key: string]: any;
};

type PolicyActivityTimelineProps = {
  logs: PolicyActivityLog[];
  emptyMessage?: string;
};

export default function PolicyActivityTimeline({
  logs,
  emptyMessage = 'No recent activity recorded for this escalation policy.',
}: PolicyActivityTimelineProps) {
  const items: ActivityTimelineItem[] = logs.map(log => ({
    id: log.id,
    action: log.action,
    createdAt: log.createdAt,
    actor: log.actor || (log.actorName ? { name: log.actorName, email: log.actorEmail } : null),
    details: log.details,
  }));

  return (
    <ActivityTimeline
      items={items}
      emptyTitle="No recent activity"
      emptyDescription={emptyMessage}
    />
  );
}
