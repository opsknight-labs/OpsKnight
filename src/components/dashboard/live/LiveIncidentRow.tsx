'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Check, Clock3, Loader2, Plus, Star, UserPlus, UserRound } from 'lucide-react';
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
  'md:grid-cols-[2.75rem_minmax(0,1fr)_6.75rem_8rem_minmax(0,8.5rem)_5.25rem]';
export const LIVE_ROW_GRID_TV = 'md:grid-cols-[3.5em_minmax(0,1fr)_7.5em_9.5em_minmax(0,10em)]';

const HOUR = 3_600_000;

/**
 * SLA visual hierarchy: a loud chip only when it is actionable (due soon or just breached);
 * long-breached incidents get quiet text so they do not drown out what can still be saved.
 */
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
  const phase = sla.phase === 'resolve' ? 'Resolve' : 'Ack';
  if (!sla.deadline) {
    return hideWhenNone ? null : (
      <span className="text-[11px] text-muted-foreground/70" aria-label="No SLA target">
        —
      </span>
    );
  }
  const delta = Date.parse(sla.deadline) - now;
  const textSize = size === 'tv' ? 'text-[0.8em]' : 'text-[11px]';
  if (delta > 30 * 60_000 && sla.warning === 'NONE') {
    return hideWhenNone ? null : (
      <span className={cn(textSize, 'text-muted-foreground')} data-sla="ok">
        {phase} in {formatCountdown(sla.deadline, now).replace(' left', '')}
      </span>
    );
  }
  if (delta < -HOUR) {
    return (
      <span
        className={cn(
          textSize,
          'whitespace-nowrap font-medium tabular-nums text-rose-700/80 dark:text-rose-400/80'
        )}
        data-testid="live-sla-chip"
        data-sla="breached-long"
        title={`${phase} SLA breached`}
      >
        {phase === 'Resolve' ? 'Res.' : 'Ack'} breached{' '}
        {formatCountdown(sla.deadline, now)
          .replace(' over', '')
          .replace(/(\d+h)\d+m$/, '$1')}
      </span>
    );
  }
  const breached = delta <= 0;
  return (
    <span
      data-testid="live-sla-chip"
      data-sla={breached ? 'breached' : 'approaching'}
      title={`${phase} SLA ${breached ? 'breached' : 'due soon'}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border font-semibold tabular-nums',
        size === 'tv' ? 'px-2 py-0.5 text-[0.8em]' : 'px-1.5 py-0.5 text-[11px]',
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
        {phase}{' '}
        {breached
          ? formatCountdown(sla.deadline, now)
          : `in ${formatCountdown(sla.deadline, now).replace(' left', '')}`}
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
  pinned: boolean;
  busy: 'ack' | 'assign' | null;
  onAcknowledge: (incident: LiveIncident) => void;
  onAssignSelf: (incident: LiveIncident) => void;
  onTogglePin: (id: string) => void;
  onFocusRow: (index: number) => void;
  density?: 'comfortable' | 'compact';
  tv?: boolean;
};

const iconButton =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card p-0 text-foreground disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');
}

export const LiveIncidentRow = memo(function LiveIncidentRow({
  incident,
  index,
  now,
  highlighted,
  focused,
  canAcknowledge,
  canAssignSelf,
  isMine,
  pinned,
  busy,
  onAcknowledge,
  onAssignSelf,
  onTogglePin,
  onFocusRow,
  density = 'comfortable',
  tv = false,
}: RowProps) {
  const accent = incident.status === 'OPEN' ? 'bg-rose-500/70' : null;
  const showAck = canAcknowledge && incident.status === 'OPEN';
  const showAssign = canAssignSelf && !isMine && incident.assignee !== null;
  const compact = density === 'compact' && !tv;
  const isNew = Date.parse(incident.createdAt) > now - 5 * 60_000;

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

  const owner = incident.assignee ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
          tv ? 'h-[1.5em] w-[1.5em] text-[0.6em]' : 'h-5 w-5 text-[9px]'
        )}
      >
        {initialsOf(incident.assignee.name)}
      </span>
      <span className="truncate text-foreground">{incident.assignee.name}</span>
    </span>
  ) : canAssignSelf && !tv ? (
    <button
      type="button"
      data-testid="live-assign-ghost"
      onClick={() => onAssignSelf(incident)}
      disabled={busy !== null}
      title="Assign to me (m)"
      className="inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/60 hover:text-primary disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-slate-700"
    >
      {busy === 'assign' ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Plus className="h-3 w-3 shrink-0" aria-hidden />
      )}
      Assign
    </button>
  ) : (
    <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
      <UserRound className={cn('shrink-0', tv ? 'h-[1em] w-[1em]' : 'h-3.5 w-3.5')} aria-hidden />
      Unassigned
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
        highlighted ? 'bg-primary/[0.07]' : '',
        focused && 'bg-muted/60'
      )}
    >
      {accent && (
        <span aria-hidden className={cn('absolute bottom-0 left-0 top-0 w-[2px]', accent)} />
      )}
      <div
        className={cn(
          'grid items-center gap-x-3 pl-4 pr-3',
          tv
            ? 'gap-y-1 py-[0.9vh] md:gap-x-4'
            : compact
              ? 'gap-y-0.5 py-1.5 md:py-1'
              : 'gap-y-1 py-2.5 md:py-2',
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
          {!compact && (
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-muted-foreground',
                tv ? 'text-[0.85em]' : 'text-[11px]'
              )}
            >
              <span className="truncate">
                {incident.service.name}
                {incident.team ? ` · ${incident.team.name}` : ''}
              </span>
              <span aria-hidden className="text-muted-foreground/50">
                ·
              </span>
              <time
                dateTime={incident.createdAt}
                title={new Date(incident.createdAt).toLocaleString()}
                className="shrink-0 font-medium tabular-nums"
              >
                {formatIncidentAge(incident.createdAt, now)}
              </time>
              {incident.escalationLevel !== null && (
                <span className="shrink-0 rounded bg-violet-50 px-1 font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                  Esc L{incident.escalationLevel}
                </span>
              )}
              {incident.alertCount > 1 && (
                <span className="shrink-0 rounded bg-muted px-1 font-medium tabular-nums">
                  ×{incident.alertCount} alerts
                </span>
              )}
              {incident.responderCount > 0 && (
                <span className="hidden shrink-0 rounded bg-muted px-1 font-medium tabular-nums lg:inline">
                  {incident.responderCount} watching
                </span>
              )}
              {isNew && !tv && (
                <span className="shrink-0 rounded bg-blue-50 px-1 text-[10px] font-bold uppercase text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                  New
                </span>
              )}
            </span>
          )}
          {/* Phones: state and owner stack under the title. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs md:hidden">
            {status}
            <SlaChip incident={incident} now={now} hideWhenNone />
            {owner}
          </span>
        </span>

        <span className="hidden md:block">{status}</span>
        <span className="hidden min-w-0 md:block">
          <SlaChip incident={incident} now={now} size={tv ? 'tv' : 'sm'} />
        </span>
        <span className={cn('hidden min-w-0 md:block', tv ? 'text-[0.95em]' : 'text-xs')}>
          {owner}
        </span>

        {!tv && (
          <span className="flex items-center justify-end gap-1 self-start transition-opacity md:self-center md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
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
            <button
              type="button"
              data-testid="live-pin"
              onClick={() => onTogglePin(incident.id)}
              aria-pressed={pinned}
              title={pinned ? 'Unpin' : 'Pin to the top'}
              aria-label={`${pinned ? 'Unpin' : 'Pin'} ${incident.title}`}
              className={cn(
                iconButton,
                pinned
                  ? 'border-amber-300 bg-amber-50 text-amber-600 dark:bg-amber-950/40'
                  : 'hover:border-amber-300 hover:text-amber-600'
              )}
            >
              <Star className={cn('h-3.5 w-3.5 shrink-0', pinned && 'fill-current')} aria-hidden />
            </button>
          </span>
        )}
      </div>
    </li>
  );
});
