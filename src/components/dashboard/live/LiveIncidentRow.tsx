'use client';

import UserAvatar from '@/components/UserAvatar';
import { memo } from 'react';
import Link from 'next/link';
import { Check, Clock3, Loader2, PanelRight, Plus, Star, UserPlus, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import PriorityBadge from '@/components/incident/PriorityBadge';
import StatusBadge from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';
import RelativeTime from '@/components/patterns/RelativeTime';
import { toneClasses } from '@/components/patterns/status-tone';
import { formatCountdown, type LiveIncident } from '@/lib/dashboard/live-incidents-shared';

/**
 * Shared column templates so the header and rows always align. They respond to the panel's
 * own width (the panel is an inline-size container), not the viewport, so the incident title
 * keeps its room whether the panel sits beside the rail or spans the page.
 */
export const LIVE_ROW_GRID =
  '[@container(min-width:40rem)]:grid-cols-[5.75rem_minmax(0,1fr)_7.5rem_minmax(0,7rem)_7.75rem] [@container(min-width:50rem)]:grid-cols-[5.75rem_minmax(0,1fr)_7.5rem_6.75rem_minmax(0,8.25rem)_8.25rem]';
export const LIVE_ROW_GRID_TV = 'md:grid-cols-[6.5em_minmax(0,1fr)_7.5em_9.5em_minmax(0,10em)]';

const HOUR = 3_600_000;
const TV_BADGE_CLASS = 'h-auto py-1 text-[0.7em] [&_svg]:h-[1.1em] [&_svg]:w-[1.1em]';

export function UrgencyBadge({
  urgency,
  size = 'sm',
  className,
}: {
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  size?: 'sm' | 'tv';
  className?: string;
}) {
  return (
    <SeverityBadge
      urgency={urgency}
      size="xs"
      abbreviate
      hideIcon
      className={cn(size === 'tv' && TV_BADGE_CLASS, className)}
    />
  );
}

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
      <span className="font-mono text-2xs text-muted-foreground" aria-label="No SLA target">
        —
      </span>
    );
  }
  const delta = Date.parse(sla.deadline) - now;
  const textSize = size === 'tv' ? 'text-[0.8em]' : 'text-2xs';
  if (delta > 30 * 60_000 && sla.warning === 'NONE') {
    return hideWhenNone ? null : (
      <span className={cn(textSize, 'font-mono text-muted-foreground/80')} data-sla="ok">
        {phase} in {formatCountdown(sla.deadline, now).replace(' left', '')}
      </span>
    );
  }
  if (delta < -HOUR) {
    return (
      <span
        className={cn(
          textSize,
          'whitespace-nowrap font-mono font-medium tabular-nums',
          toneClasses('critical').text
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
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-sm border font-mono font-semibold tabular-nums',
        size === 'tv' ? 'px-2 py-0.5 text-[0.8em]' : 'px-1.5 py-0.5 text-2xs',
        toneClasses(breached ? 'critical' : 'elevated').soft
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
  isSelected?: boolean;
  canAcknowledge: boolean;
  canAssignSelf: boolean;
  isMine: boolean;
  pinned: boolean;
  busy: 'ack' | 'assign' | null;
  onAcknowledge: (incident: LiveIncident) => void;
  onAssignSelf: (incident: LiveIncident) => void;
  onTogglePin: (id: string) => void;
  onFocusRow: (index: number) => void;
  onSelectRow?: (incident: LiveIncident) => void;
  density?: 'comfortable' | 'compact';
  tv?: boolean;
};

export const LiveIncidentRow = memo(function LiveIncidentRow({
  incident,
  index,
  now,
  highlighted,
  focused,
  isSelected = false,
  canAcknowledge,
  canAssignSelf,
  isMine,
  pinned,
  busy,
  onAcknowledge,
  onAssignSelf,
  onTogglePin,
  onFocusRow,
  onSelectRow,
  density = 'comfortable',
  tv = false,
}: RowProps) {
  const showAck = canAcknowledge && incident.status === 'OPEN';
  const showAssign = canAssignSelf && !isMine && incident.assignee !== null;
  const compact = density === 'compact' && !tv;
  const isNew = Date.parse(incident.createdAt) > now - 5 * 60_000;
  const iconBtnClass = cn(
    'inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    compact ? 'h-6 w-6 p-0' : 'h-7 w-7 p-0'
  );
  const actionIconClass = compact ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0';

  const status = (
    <StatusBadge
      status={incident.status}
      size="xs"
      live={incident.status === 'OPEN'}
      className={tv ? TV_BADGE_CLASS : undefined}
    />
  );

  const owner = incident.assignee ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <UserAvatar
        userId={incident.assignee.id}
        avatarUrl={incident.assignee.avatarUrl}
        name={incident.assignee.name}
        gender={incident.assignee.gender}
        size="xs"
        className={tv ? 'h-[2.5em] w-[2.5em]' : 'h-5 w-5'}
        aria-hidden
      />
      <span className="truncate text-foreground">{incident.assignee.name}</span>
    </span>
  ) : canAssignSelf && !tv ? (
    <button
      type="button"
      data-testid="live-assign-ghost"
      onClick={() => onAssignSelf(incident)}
      disabled={busy !== null}
      title="Assign to me (m)"
      aria-label={`Assign ${incident.title} to me`}
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-ink-300 text-muted-foreground outline-none transition-colors duration-150 hover:border-ink-400 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-ink-300',
        compact ? 'h-5 px-1.5 text-2xs leading-none' : 'px-2 py-0.5 text-2xs font-medium'
      )}
    >
      {busy === 'assign' ? (
        <Loader2 className={cn('animate-spin', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} aria-hidden />
      ) : (
        <Plus className={cn('shrink-0', compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} aria-hidden />
      )}
      Assign
    </button>
  ) : (
    <span className={cn('flex items-center gap-1 font-medium', toneClasses('elevated').text)}>
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
      data-selected={isSelected ? 'true' : 'false'}
      onClick={e => {
        const target = e.target as HTMLElement;
        if (target.closest('button, a')) return;
        onSelectRow?.(incident);
      }}
      className={cn(
        'group relative cursor-pointer border-l-[3px] transition-colors duration-150',
        incident.status === 'OPEN'
          ? cn(toneClasses('critical').borderLeft, 'bg-status-critical/[0.02]')
          : incident.sla.warning === 'APPROACHING' || incident.sla.warning === 'BREACHED'
            ? cn(toneClasses('elevated').borderLeft, 'bg-status-elevated/[0.02]')
            : 'border-l-transparent',
        'hover:bg-muted/40 focus-within:bg-muted/40',
        highlighted ? 'bg-primary/[0.07]' : '',
        focused && 'bg-muted/60',
        isSelected && 'bg-primary/5 dark:bg-primary/10 ring-1 ring-inset ring-primary/40'
      )}
    >
      <div
        className={cn(
          'grid items-center gap-x-3 pl-3.5 pr-3',
          tv
            ? 'gap-y-1 py-[0.9vh] md:gap-x-4'
            : compact
              ? 'gap-y-0 py-1 md:py-1'
              : 'gap-y-1 py-2.5 md:py-2',
          tv ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
          tv ? LIVE_ROW_GRID_TV : LIVE_ROW_GRID
        )}
      >
        <span
          className={cn(
            tv
              ? 'self-start md:self-center'
              : 'col-start-1 row-start-1 self-center [@container(min-width:40rem)]:col-start-auto [@container(min-width:40rem)]:row-start-auto'
          )}
        >
          <div className="flex items-center gap-1.5">
            {incident.priority ? (
              <PriorityBadge
                priority={incident.priority}
                size="sm"
                showLabel={false}
                hideIcon
                className={tv ? TV_BADGE_CLASS : undefined}
              />
            ) : (
              <span
                title="No priority set"
                aria-label="No priority"
                className="inline-flex h-5 min-w-[2.25rem] items-center justify-center rounded-md border border-dashed border-border px-1.5 font-mono text-2xs text-muted-foreground"
              >
                —
              </span>
            )}
            <UrgencyBadge urgency={incident.urgency} size={tv ? 'tv' : 'sm'} />
          </div>
        </span>

        <span
          className={cn(
            'min-w-0',
            !tv &&
              'col-span-2 row-start-2 [@container(min-width:40rem)]:col-span-1 [@container(min-width:40rem)]:row-start-auto'
          )}
        >
          <Link
            href={`/incidents/${incident.id}`}
            data-live-row-link={index}
            onFocus={() => onFocusRow(index)}
            title={incident.title}
            className={cn(
              'rounded-sm font-semibold text-foreground outline-none',
              tv
                ? 'block truncate text-[1.15em]'
                : 'line-clamp-2 break-words text-sm leading-5 [@container(min-width:40rem)]:block [@container(min-width:40rem)]:truncate',
              'hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            {incident.title}
          </Link>
          {!compact && (
            <span
              className={cn(
                'mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap overflow-hidden text-muted-foreground',
                tv ? 'text-[0.85em]' : 'text-xs'
              )}
            >
              <span className="truncate font-medium text-foreground/80">
                {incident.service.name}
                {incident.team ? ` · ${incident.team.name}` : ''}
              </span>
              <span aria-hidden className="text-muted-foreground/40 font-mono">
                /
              </span>
              <RelativeTime
                date={incident.createdAt}
                now={now}
                format="narrow"
                className={cn('shrink-0 font-mono', tv ? 'text-[0.9em]' : 'text-2xs')}
              />
              {incident.alertCount > 1 && (
                <>
                  <span aria-hidden className="text-muted-foreground/40 font-mono">
                    /
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-muted/40 px-1.5 text-2xs tabular-nums text-muted-foreground">
                    {incident.alertCount} signals · dedup
                  </span>
                </>
              )}
              {incident.escalationLevel !== null && (
                <span
                  className={cn(
                    'shrink-0 rounded-sm border px-1.5 text-2xs font-semibold tabular-nums',
                    toneClasses('elevated').soft
                  )}
                >
                  Esc T{incident.escalationLevel}
                </span>
              )}
              {incident.responderCount > 0 && (
                <span className="hidden shrink-0 rounded-sm bg-muted/60 px-1 text-2xs tabular-nums text-muted-foreground lg:inline">
                  {incident.responderCount} watching
                </span>
              )}
              {isNew && !tv && (
                <span
                  className={cn(
                    'shrink-0 rounded-sm border px-1 text-2xs font-semibold',
                    toneClasses('info').soft
                  )}
                >
                  New
                </span>
              )}
            </span>
          )}
          {/* Phones: state and owner stack under the title. */}
          <span
            className={cn(
              'mt-1.5 flex flex-wrap items-center gap-1.5 text-xs',
              tv ? 'md:hidden' : '[@container(min-width:40rem)]:hidden'
            )}
          >
            {status}
            <SlaChip incident={incident} now={now} hideWhenNone />
            {owner}
          </span>
        </span>

        <span
          className={cn('hidden min-w-0', tv ? 'md:block' : '[@container(min-width:40rem)]:block')}
        >
          {status}
          {!tv && (
            <span className="mt-1 block [@container(min-width:50rem)]:hidden">
              <SlaChip incident={incident} now={now} size="sm" hideWhenNone />
            </span>
          )}
        </span>
        <span
          className={cn('hidden min-w-0', tv ? 'md:block' : '[@container(min-width:50rem)]:block')}
        >
          <SlaChip incident={incident} now={now} size={tv ? 'tv' : 'sm'} />
        </span>
        <span
          className={cn(
            'hidden min-w-0',
            tv ? 'md:block text-[0.95em]' : '[@container(min-width:40rem)]:block text-xs'
          )}
        >
          {owner}
        </span>

        {!tv && (
          <span className="col-start-2 row-start-1 flex items-center justify-end gap-1 [@container(min-width:40rem)]:col-start-auto [@container(min-width:40rem)]:row-start-auto [@container(min-width:40rem)]:self-center">
            {showAck && (
              <button
                type="button"
                data-testid="live-ack"
                onClick={() => onAcknowledge(incident)}
                disabled={busy !== null}
                title="Acknowledge (a)"
                aria-label={`Acknowledge ${incident.title}`}
                className={iconBtnClass}
              >
                {busy === 'ack' ? (
                  <Loader2 className={cn('animate-spin', actionIconClass)} aria-hidden />
                ) : (
                  <Check className={actionIconClass} aria-hidden />
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
                className={iconBtnClass}
              >
                {busy === 'assign' ? (
                  <Loader2 className={cn('animate-spin', actionIconClass)} aria-hidden />
                ) : (
                  <UserPlus className={actionIconClass} aria-hidden />
                )}
              </button>
            )}
            <button
              type="button"
              data-testid="live-inspect"
              onClick={() => onSelectRow?.(incident)}
              title={isSelected ? 'Close inspector (Esc)' : 'Inspect details (Space)'}
              aria-label={`Inspect ${incident.title}`}
              aria-pressed={isSelected}
              className={cn(
                iconBtnClass,
                isSelected && 'border-foreground/40 bg-muted text-foreground'
              )}
            >
              <PanelRight className={actionIconClass} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="live-pin"
              onClick={() => onTogglePin(incident.id)}
              aria-pressed={pinned}
              title={pinned ? 'Unpin' : 'Pin to the top'}
              aria-label={`${pinned ? 'Unpin' : 'Pin'} ${incident.title}`}
              className={cn(
                iconBtnClass,
                pinned && 'border-foreground/40 bg-muted text-foreground'
              )}
            >
              <Star className={cn(actionIconClass, pinned && 'fill-current')} aria-hidden />
            </button>
          </span>
        )}
      </div>
    </li>
  );
});
