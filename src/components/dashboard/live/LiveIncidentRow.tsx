'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Check, Clock3, Loader2, UserPlus, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import PriorityBadge from '@/components/incident/PriorityBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  formatCountdown,
  formatIncidentAge,
  type LiveIncident,
} from '@/lib/dashboard/live-incidents-shared';

/** Shared column templates so the desktop header and rows always align. */
export const LIVE_ROW_GRID =
  'md:grid-cols-[2.75rem_minmax(0,1fr)_6.5rem_8rem_minmax(0,7.5rem)_4rem]';
export const LIVE_ROW_GRID_TV = 'md:grid-cols-[3.5em_minmax(0,1fr)_7.5em_9.5em_minmax(0,10em)]';

export function SlaChip({
  incident,
  now,
  hideWhenNone = false,
  size = 'sm',
}: {
  incident: LiveIncident;
  now: number;
  hideWhenNone?: boolean;
  size?: 'sm' | 'tv';
}) {
  const { sla } = incident;
  if (sla.warning === 'NONE' || !sla.deadline) {
    return hideWhenNone ? null : (
      <span className="text-[11px] text-muted-foreground/70" aria-label="Within SLA">
        —
      </span>
    );
  }
  const breached = sla.warning === 'BREACHED' || Date.parse(sla.deadline) <= now;
  return (
    <span
      data-testid="live-sla-chip"
      data-sla={breached ? 'breached' : 'approaching'}
      title={`${sla.phase === 'ack' ? 'Acknowledge' : 'Resolve'} SLA ${breached ? 'breached' : 'at risk'}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border font-semibold tabular-nums whitespace-nowrap',
        size === 'tv' ? 'px-2 py-0.5 text-[0.8em]' : 'px-1.5 py-0.5 text-[10px]',
        breached
          ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
          : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
      )}
    >
      <Clock3
        className={cn('shrink-0', size === 'tv' ? 'h-[1em] w-[1em]' : 'h-3 w-3')}
        aria-hidden
      />
      <span className="truncate">
        {sla.phase === 'ack' ? 'Ack' : 'Res'} {formatCountdown(sla.deadline, now)}
      </span>
    </span>
  );
}

type RowProps = {
  incident: LiveIncident;
  index: number;
  now: number;
  highlighted: boolean;
  focused: boolean;
  canAcknowledge: boolean;
  canAssignSelf: boolean;
  isMine: boolean;
  busy: 'ack' | 'assign' | null;
  onAcknowledge: (incident: LiveIncident) => void;
  onAssignSelf: (incident: LiveIncident) => void;
  onFocusRow: (index: number) => void;
  tv?: boolean;
};

const iconButton =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card p-0 text-foreground disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

export const LiveIncidentRow = memo(function LiveIncidentRow({
  incident,
  index,
  now,
  highlighted,
  focused,
  canAcknowledge,
  canAssignSelf,
  isMine,
  busy,
  onAcknowledge,
  onAssignSelf,
  onFocusRow,
  tv = false,
}: RowProps) {
  const accent = incident.status === 'OPEN' ? 'bg-rose-500' : 'bg-amber-500';
  const showAck = canAcknowledge && incident.status === 'OPEN';
  const showAssign = canAssignSelf && !isMine;
  const status = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap font-medium',
        tv ? 'text-[0.9em]' : 'text-xs',
        incident.status === 'OPEN'
          ? 'text-rose-700 dark:text-rose-400'
          : 'text-amber-700 dark:text-amber-400'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          incident.status === 'OPEN' ? 'bg-rose-500' : 'bg-amber-500'
        )}
      />
      {incident.status === 'OPEN' ? 'Triggered' : 'Acknowledged'}
    </span>
  );
  const assigneeName = incident.assignee?.name ?? null;
  const initials = assigneeName
    ? assigneeName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join('')
    : null;
  const assignee = (
    <span className="flex min-w-0 items-center gap-1.5">
      {initials ? (
        <span
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary',
            tv ? 'h-[1.5em] w-[1.5em] text-[0.65em]' : 'h-5 w-5 text-[9px]'
          )}
        >
          {initials}
        </span>
      ) : (
        <UserRound
          className={cn(
            'shrink-0 text-amber-600 dark:text-amber-400',
            tv ? 'h-[1em] w-[1em]' : 'h-3.5 w-3.5'
          )}
          aria-hidden
        />
      )}
      <span
        className={cn(
          'truncate',
          assigneeName ? 'text-foreground' : 'font-medium text-amber-700 dark:text-amber-400'
        )}
      >
        {assigneeName ?? 'Unassigned'}
      </span>
    </span>
  );

  return (
    <li
      data-testid="live-incident-row"
      data-incident-id={incident.id}
      data-status={incident.status}
      data-highlighted={highlighted ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      className={cn(
        'group relative transition-colors duration-700',
        'hover:bg-muted/40 focus-within:bg-muted/40',
        highlighted ? 'bg-primary/[0.08]' : 'bg-transparent',
        focused && 'bg-muted/60'
      )}
    >
      <span aria-hidden className={cn('absolute bottom-0 left-0 top-0 w-[3px]', accent)} />
      <div
        className={cn(
          'grid items-center gap-x-2.5 pl-4 pr-3',
          tv ? 'gap-y-1 py-[0.9vh] md:gap-x-4' : 'gap-y-1 py-2.5 md:py-[7px]',
          'grid-cols-[auto_minmax(0,1fr)_auto]',
          tv ? LIVE_ROW_GRID_TV : LIVE_ROW_GRID
        )}
      >
        <span className="self-start md:self-center">
          {incident.priority ? (
            <PriorityBadge
              priority={incident.priority}
              size={tv ? 'md' : 'sm'}
              showLabel={false}
              className={tv ? '!h-auto !px-2.5 !py-1 !text-[0.8em]' : undefined}
            />
          ) : (
            <Badge variant="neutral" size="xs" className="font-mono">
              {incident.urgency}
            </Badge>
          )}
        </span>

        <span className="min-w-0">
          <Link
            href={`/incidents/${incident.id}`}
            data-live-row-link={index}
            onFocus={() => onFocusRow(index)}
            title={incident.title}
            className={cn(
              'block rounded-sm font-semibold text-foreground outline-none',
              tv ? 'truncate' : 'line-clamp-2 break-words md:line-clamp-none md:truncate',
              'hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50',
              tv ? 'text-[1.15em]' : 'text-[13px] leading-5'
            )}
          >
            {incident.title}
          </Link>
          <span
            className={cn(
              'flex min-w-0 items-center gap-1 text-muted-foreground',
              tv ? 'text-[0.85em]' : 'text-[11px]'
            )}
          >
            <span className="truncate">
              {incident.service.name}
              {incident.team ? ` · ${incident.team.name}` : ''}
            </span>
            <span aria-hidden>·</span>
            <time
              dateTime={incident.createdAt}
              title={new Date(incident.createdAt).toLocaleString()}
              className="shrink-0 font-medium tabular-nums"
            >
              {formatIncidentAge(incident.createdAt, now)}
            </time>
          </span>
          {/* Phones: state and owner stack under the title. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs md:hidden">
            {status}
            <SlaChip incident={incident} now={now} hideWhenNone />
            {assignee}
          </span>
        </span>

        <span className="hidden md:block">{status}</span>
        <span className="hidden min-w-0 md:block">
          <SlaChip incident={incident} now={now} size={tv ? 'tv' : 'sm'} />
        </span>
        <span className={cn('hidden min-w-0 md:block', tv ? 'text-[0.95em]' : 'text-xs')}>
          {assignee}
        </span>

        {!tv && (
          <span className="flex items-center justify-end gap-1 self-start transition-opacity md:self-center md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {showAck && (
              <button
                type="button"
                data-testid="live-ack"
                onClick={() => onAcknowledge(incident)}
                disabled={busy !== null}
                title="Acknowledge (a)"
                aria-label={`Acknowledge ${incident.title}`}
                className={cn(
                  iconButton,
                  'hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40'
                )}
              >
                {busy === 'ack' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
              </button>
            )}
            {showAssign && (
              <button
                type="button"
                data-testid="live-assign-me"
                onClick={() => onAssignSelf(incident)}
                disabled={busy !== null}
                title="Assign to me (m)"
                aria-label={`Assign ${incident.title} to me`}
                className={cn(
                  iconButton,
                  'hover:border-primary/50 hover:bg-primary/5 hover:text-primary'
                )}
              >
                {busy === 'assign' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
              </button>
            )}
          </span>
        )}
      </div>
    </li>
  );
});
