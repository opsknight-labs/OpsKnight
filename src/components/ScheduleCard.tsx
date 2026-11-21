import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import UserAvatar from '@/components/UserAvatar';
import { RelativeTime } from '@/components/patterns';
import { Clock, Layers, Users, Calendar } from 'lucide-react';
import InsightBadge from '@/components/intelligence/insights/InsightBadge';
import type { OpsInsightCount } from '@/lib/intelligence/ops-insights/contract';
import type { ScheduleOnCallSummary } from '@/components/schedules/schedule-oncall-summary';

type ScheduleCardSchedule = {
  id: string;
  name: string;
  timeZone: string;
  layers: Array<{
    users: Array<{
      userId: string;
      user?: {
        name: string;
        avatarUrl?: string | null;
        gender?: string | null;
      } | null;
    }>;
  }>;
} & Partial<ScheduleOnCallSummary>;

/** Unique responders across all layers, in layer order. */
export function scheduleResponders(schedule: Pick<ScheduleCardSchedule, 'layers'>) {
  const unique = new Map<
    string,
    { userId: string; name: string; avatarUrl?: string | null; gender?: string | null }
  >();
  schedule.layers.forEach(layer => {
    layer.users.forEach(u => {
      if (!unique.has(u.userId)) {
        unique.set(u.userId, {
          userId: u.userId,
          name: u.user?.name || 'Responder',
          avatarUrl: u.user?.avatarUrl,
          gender: u.user?.gender,
        });
      }
    });
  });
  return Array.from(unique.values());
}

/** Up to three responder avatars and a "+N" overflow; full names on hover. */
export function ScheduleResponderStack({
  schedule,
}: {
  schedule: Pick<ScheduleCardSchedule, 'layers'>;
}) {
  const responders = scheduleResponders(schedule);
  if (responders.length === 0) return null;
  return (
    <span
      className="flex items-center -space-x-1.5 overflow-hidden"
      title={responders.map(r => r.name).join(', ')}
    >
      {responders.slice(0, 3).map(r => (
        <UserAvatar
          key={r.userId}
          userId={r.userId}
          avatarUrl={r.avatarUrl}
          name={r.name}
          gender={r.gender}
          size="xs"
          className="h-5 w-5 ring-1.5 ring-background"
        />
      ))}
      {responders.length > 3 && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-2xs font-bold text-muted-foreground ring-1.5 ring-background">
          +{responders.length - 3}
        </span>
      )}
    </span>
  );
}

export default function ScheduleCard({
  schedule,
  insights,
}: {
  schedule: ScheduleCardSchedule;
  /** Open operations insights on this schedule, for the list badge. */
  insights?: OpsInsightCount | null;
}) {
  const uniqueUsers = scheduleResponders(schedule);

  return (
    <Link
      href={`/schedules/${schedule.id}`}
      className="group block rounded-lg border border-border bg-card p-3 transition-colors duration-150 hover:border-primary/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Calendar className="h-4 w-4" aria-hidden="true" />
          </span>
          <span
            className="truncate text-sm font-semibold text-foreground group-hover:text-primary"
            title={schedule.name}
          >
            {schedule.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <InsightBadge count={insights} />
          <Badge variant="outline" size="xs" className="gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            {schedule.timeZone}
          </Badge>
        </div>
      </div>

      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">On call now:</span>
          {schedule.onCallNow && (
            <UserAvatar
              userId={schedule.onCallNow.userId}
              avatarUrl={schedule.onCallNow.avatarUrl}
              name={schedule.onCallNow.name}
              gender={schedule.onCallNow.gender}
              size="xs"
              aria-hidden
            />
          )}
          <span className="truncate font-medium text-foreground">
            {schedule.onCallNow?.name ?? (uniqueUsers.length ? 'No one' : '—')}
          </span>
        </div>
        {schedule.next && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">Next:</span>
            <UserAvatar
              userId={schedule.next.userId}
              avatarUrl={schedule.next.avatarUrl}
              name={schedule.next.name}
              gender={schedule.next.gender}
              size="xs"
              aria-hidden
            />
            <span className="truncate">
              <span className="font-medium text-foreground">{schedule.next.name}</span>{' '}
              <RelativeTime date={schedule.next.start} format="long" />
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            {schedule.layers.length} {schedule.layers.length === 1 ? 'layer' : 'layers'}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {uniqueUsers.length} {uniqueUsers.length === 1 ? 'responder' : 'responders'}
          </span>
        </div>

        {uniqueUsers.length > 0 ? (
          <ScheduleResponderStack schedule={schedule} />
        ) : (
          <Badge variant="warning" size="xs">
            Needs setup
          </Badge>
        )}
      </div>
    </Link>
  );
}
