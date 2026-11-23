import { CalendarClock, Check, Hash } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { toneClasses } from '@/components/patterns/status-tone';
import { getViewableScheduleWhere } from '@/lib/rbac';
import {
  loadIncidentResponders,
  type DeliveryState,
  type OnCallView,
  type ResponderView,
  type RespondersView,
} from '@/lib/incidents/responders';
import { cn } from '@/lib/utils';

const VISIBLE_PEOPLE = 5;

const STATE_LABEL: Record<DeliveryState, string> = {
  delivered: 'delivered',
  sent: 'sent',
  pending: 'pending',
  unknown: 'unknown',
  skipped: 'skipped',
  failed: 'failed',
};

function Dot({ tone }: { tone: Parameters<typeof toneClasses>[0] }) {
  return (
    <span
      aria-hidden
      className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', toneClasses(tone).solid)}
    />
  );
}

function PersonRow({ person }: { person: ResponderView }) {
  const failed = person.channels.filter(channel => channel.reason);
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      {person.kind === 'user' && person.userId ? (
        <UserAvatar
          userId={person.userId}
          name={person.name}
          avatarUrl={person.avatarUrl}
          gender={person.gender}
          size="xs"
          aria-hidden
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Hash className="h-3 w-3" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate font-medium text-foreground">{person.name}</span>
          {person.role && (
            <span className="shrink-0 text-2xs text-muted-foreground">{person.role}</span>
          )}
          {person.ack && (
            <Check
              className={cn('h-3.5 w-3.5 shrink-0', toneClasses('ok').text)}
              aria-label="Acknowledged"
            />
          )}
        </p>
        <p className={cn('text-2xs', toneClasses(person.tone).text)}>
          {person.ack ? <time dateTime={person.ack.at}>{person.summary}</time> : person.summary}
          {person.firstPagedAt && (
            <span className="text-muted-foreground">
              {' · paged '}
              <time dateTime={person.firstPagedAt}>{person.firstPagedAgo}</time>
            </span>
          )}
        </p>
        {person.via && <p className="truncate text-2xs text-muted-foreground">{person.via}</p>}
        {person.channels.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1" aria-label="Channels">
            {person.channels.map(channel => (
              <li
                key={channel.channel}
                title={channel.reason ?? undefined}
                className={cn(
                  'inline-flex items-center rounded border px-1.5 py-px text-2xs',
                  toneClasses(channel.tone).soft
                )}
              >
                {channel.label} · {STATE_LABEL[channel.state]}
              </li>
            ))}
          </ul>
        )}
        {failed.map(channel => (
          <p
            key={channel.channel}
            className="mt-0.5 truncate text-2xs text-muted-foreground"
            title={channel.reason ?? undefined}
          >
            {channel.label}: {channel.reason}
          </p>
        ))}
      </div>
    </li>
  );
}

function OnCallSection({ onCall }: { onCall: OnCallView }) {
  return (
    <div className="px-3 py-2">
      <p className="flex items-center gap-1.5 text-2xs font-semibold text-muted-foreground">
        <CalendarClock className={cn('h-3 w-3', toneClasses('shift').text)} aria-hidden />
        On call for this service
      </p>
      {onCall.kind === 'no-schedule' && (
        <p className="mt-1 text-xs text-muted-foreground">
          This escalation policy pages no on-call schedule.
        </p>
      )}
      {onCall.kind === 'restricted' && (
        <p className="mt-1 text-xs text-muted-foreground">
          You can&apos;t view this service&apos;s on-call schedules.
        </p>
      )}
      {onCall.kind === 'schedules' && (
        <ul className="mt-1 space-y-1.5">
          {onCall.schedules.map(schedule => (
            <li key={schedule.id} className="text-xs">
              <p className="truncate text-2xs text-muted-foreground">{schedule.name}</p>
              {schedule.now.length === 0 ? (
                <p className={cn('text-xs', toneClasses('critical').text)}>No one on call now</p>
              ) : (
                schedule.now.map(entry => (
                  <p key={entry.userId} className="flex min-w-0 items-baseline gap-1.5 text-xs">
                    <span className={cn('font-medium', toneClasses('shift').text)}>Now</span>
                    <span className="truncate text-foreground">{entry.name}</span>
                    <time
                      dateTime={entry.until}
                      className="shrink-0 text-2xs text-muted-foreground"
                    >
                      {entry.endsIn}
                    </time>
                  </p>
                ))
              )}
              {schedule.next && (
                <p className="flex min-w-0 items-baseline gap-1.5 text-xs">
                  <span className="font-medium text-muted-foreground">Next</span>
                  <span className="truncate text-foreground">{schedule.next.name}</span>
                  <time
                    dateTime={schedule.next.start}
                    className="shrink-0 text-2xs text-muted-foreground"
                  >
                    {schedule.next.startsIn}
                  </time>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Presentational: render a view model built by `loadIncidentResponders`. */
export function IncidentRespondersPanel({
  view,
  className,
}: {
  view: RespondersView;
  className?: string;
}) {
  const { people, escalation, onCall } = view;
  const shown = people.slice(0, VISIBLE_PEOPLE);
  const rest = people.slice(VISIBLE_PEOPLE);
  return (
    <section
      aria-label="Responders"
      className={cn(
        'overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Responders
          <span className="font-normal tabular-nums text-muted-foreground">{people.length}</span>
        </h2>
      </div>
      <div className="flex flex-col divide-y divide-border/50">
        <div className="flex items-start gap-2 px-3 py-2">
          <Dot tone={escalation.tone} />
          <div className="min-w-0">
            <p className={cn('text-xs font-medium', toneClasses(escalation.tone).text)}>
              {escalation.label}
            </p>
            {(escalation.progress || escalation.next) && (
              <p className="text-2xs text-muted-foreground">
                {[escalation.progress, escalation.next].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        {people.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No one has been paged yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/50">
            {shown.map(person => (
              <PersonRow key={person.key} person={person} />
            ))}
            {rest.length > 0 && (
              <li>
                <details className="group">
                  <summary className="cursor-pointer list-none px-3 py-1.5 text-2xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">+{rest.length} more</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <ul className="flex flex-col divide-y divide-border/50 border-t border-border/50">
                    {rest.map(person => (
                      <PersonRow key={person.key} person={person} />
                    ))}
                  </ul>
                </details>
              </li>
            )}
          </ul>
        )}
        {onCall && <OnCallSection onCall={onCall} />}
      </div>
    </section>
  );
}

/**
 * Server component for the incident page's side column. Render only after the page's
 * assertCanViewIncident check; renders nothing if the read fails.
 */
export default async function IncidentRespondersCard({
  incidentId,
  viewerId,
  className,
}: {
  incidentId: string;
  viewerId: string;
  className?: string;
}) {
  // Viewers without schedule read get no on-call section rather than an error.
  const scheduleWhere = await getViewableScheduleWhere().catch(() => null);
  const view = await loadIncidentResponders({ incidentId, viewerId, scheduleWhere });
  return view ? <IncidentRespondersPanel view={view} className={className} /> : null;
}
