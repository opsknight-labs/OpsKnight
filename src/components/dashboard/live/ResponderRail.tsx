'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock3,
  UserRound,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import UserAvatar from '@/components/UserAvatar';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  formatIncidentAge,
  isCriticalIncident,
  type LiveIncident,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';
import { SlaChip } from './LiveIncidentRow';

type RailAction = { label: string; href?: string; onClick?: () => void };

/** One quiet text action for every rail/section header ("Show all", "Schedules →"…). */
const railActionClass =
  'shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
/** Shared row chrome for incident/attention/service lines inside the rail. */
const railRowClass =
  'group rounded-md border border-border bg-card outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring';

/** Compact, consistent card used across the rail, the cockpit and the wallboard. */
function RailCard({
  title,
  count,
  subtitle,
  icon,
  action,
  grow = false,
  testId,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  icon: React.ReactNode;
  action?: RailAction;
  grow?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        grow ? 'xl:min-h-[9rem] xl:flex-1' : 'shrink-0'
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="dash-heading-sm flex items-center gap-1.5 truncate">
            {title}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </h3>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action &&
          (action.href ? (
            <Link href={action.href} className={railActionClass}>
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className={railActionClass}>
              {action.label}
            </button>
          ))}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
    </section>
  );
}

function EmptyLine({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
      {icon}
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <Link href={action.href} className={railActionClass}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

function IncidentLine({
  incident,
  now,
  trailing,
}: {
  incident: LiveIncident;
  now: number;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className={cn(railRowClass, 'flex items-center gap-2.5 px-2.5 py-2')}
    >
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          toneClasses(isCriticalIncident(incident) ? 'critical' : 'elevated').solid
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{incident.title}</span>
        <span className="block truncate text-2xs tabular-nums text-muted-foreground">
          {incident.service.name} · {formatIncidentAge(incident.createdAt, now)}
        </span>
      </span>
      {trailing}
    </Link>
  );
}

export function SlaRiskCard({ grow = false }: { grow?: boolean } = {}) {
  const { snapshot, now, setQuery } = useLiveDashboard();
  const items = snapshot?.rail.slaRisk ?? [];
  const summary = snapshot?.summary;
  return (
    <RailCard
      title="SLA at Risk"
      count={summary?.slaAtRisk}
      subtitle={
        summary
          ? `${summary.slaDueSoon} due <10m · ${summary.slaRecentlyBreached} breached <1h`
          : 'Acknowledge and resolve targets'
      }
      icon={<Clock3 className="h-3.5 w-3.5" />}
      action={{ label: 'Show all', onClick: () => setQuery({ view: 'breaching' }) }}
      grow={grow}
      testId="rail-sla-card"
    >
      <div className="space-y-1.5" data-testid="rail-sla-risk">
        {items.length === 0 ? (
          <EmptyLine
            icon={<CheckCircle2 className="h-4 w-4 shrink-0 text-status-ok" aria-hidden />}
            text="Everything is within SLA"
          />
        ) : (
          items.map(incident => (
            <IncidentLine
              key={incident.id}
              incident={incident}
              now={now}
              trailing={<SlaChip incident={incident} now={now} />}
            />
          ))
        )}
      </div>
    </RailCard>
  );
}

export function OnCallCard() {
  const { snapshot } = useLiveDashboard();
  const shifts = snapshot?.rail.onCall ?? [];
  return (
    <RailCard
      title="On-Call Now"
      count={shifts.length}
      subtitle={shifts.length ? 'Current responders' : undefined}
      icon={<Users className="h-3.5 w-3.5" />}
      action={{ label: 'Schedules', href: '/schedules' }}
    >
      <ul className="space-y-0.5" data-testid="rail-on-call" aria-label="Active on-call shifts">
        {shifts.length === 0 ? (
          <li>
            <EmptyLine
              icon={<AlertTriangle className="h-4 w-4 shrink-0 text-status-elevated" aria-hidden />}
              text="No active on-call shifts"
              action={{ label: 'Set up', href: '/schedules' }}
            />
          </li>
        ) : (
          shifts.slice(0, 3).map(shift => (
            <li key={shift.id}>
              <Link
                href="/schedules"
                className="flex items-center gap-2.5 rounded-md px-1.5 py-1 outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="relative shrink-0">
                  <UserAvatar
                    userId={shift.user.id ?? ''}
                    name={shift.user.name}
                    avatarUrl={shift.user.avatarUrl}
                    gender={shift.user.gender}
                    size="xs"
                    aria-hidden
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-status-shift ring-2 ring-card" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {shift.user.name}
                  </span>
                  <span className="flex items-center gap-1 truncate text-2xs text-muted-foreground">
                    <Calendar className="h-3 w-3 shrink-0" aria-hidden />
                    {shift.scheduleName}
                  </span>
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </RailCard>
  );
}
function formatUntil(iso: string | null, now: number): string {
  if (!iso) return '';
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 0) return 'ending now';
  if (minutes < 60) return `for ${minutes}m more`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `for ${hours}h ${minutes % 60}m more`;
  return `until ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

const ATTENTION_TONE: Record<'rose' | 'amber' | 'violet', string> = {
  rose: toneClasses('critical').soft,
  amber: toneClasses('elevated').soft,
  violet: toneClasses(null).soft,
};

/**
 * Ops Pulse: what needs the viewer next, beside the live feed. Every section is derived from the
 * same authorized live snapshot, so it costs no extra queries. `aiops` is an optional server-rendered
 * row (the AIOps pulse tile); the page omits it when there is nothing to show.
 */
export function OpsPulsePanel({ aiops }: { aiops?: ReactNode } = {}) {
  const { snapshot, now, currentUserId, query, setQuery } = useLiveDashboard();
  const coverage = snapshot?.coverage;
  const attention = snapshot?.attention ?? [];
  const services = (snapshot?.rail.servicesAtRisk ?? []).slice(0, 5);
  const shifts = snapshot?.rail.onCall ?? [];
  const max = Math.max(1, ...services.map(service => service.count));
  const mine = snapshot?.summary.mine ?? 0;
  const queueTop = (snapshot?.rail.myQueue ?? []).slice(0, 2);
  const queueHref = buildIncidentListHref({ filter: 'all_open', assignee: currentUserId });

  return (
    <section
      aria-labelledby="ops-pulse-heading"
      data-testid="ops-pulse"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          >
            <Activity className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h2 id="ops-pulse-heading" className="dash-heading whitespace-nowrap">
              Ops Pulse
            </h2>
            <p className="truncate text-xs text-muted-foreground">What needs you next</p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold',
            toneClasses('ok').soft
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', toneClasses('ok').solid)} aria-hidden />
          Live
        </span>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
        <section className="px-4 py-3" data-testid="pulse-you">
          <div
            className={cn(
              'rounded-md border p-3',
              coverage?.me.onCall ? toneClasses('shift').soft : 'border-border bg-muted/30'
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  coverage?.me.onCall ? 'bg-card' : 'bg-muted text-muted-foreground'
                )}
              >
                <UserRound className="h-4 w-4" />
                {coverage?.me.onCall && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-status-shift ring-2 ring-card" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">
                  {coverage?.me.onCall
                    ? `You're on call · ${coverage.me.schedules.join(', ')}`
                    : 'Not on call'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {coverage?.me.onCall ? `${formatUntil(coverage.me.until, now)} · ` : ''}
                  {mine === 0 ? 'Your queue is clear' : `${mine} in your queue`}
                </p>
              </div>
              <Link
                href={queueHref}
                className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                Queue →
              </Link>
            </div>
            {queueTop.length > 0 && (
              <div className="mt-2.5 space-y-1.5" data-testid="rail-my-queue">
                {queueTop.map(incident => (
                  <IncidentLine key={incident.id} incident={incident} now={now} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="px-4 py-3" data-testid="pulse-attention">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="dash-eyebrow flex items-center gap-1.5">
              Needs attention
              {attention.length > 0 && (
                <span
                  className={cn(
                    'rounded-full border px-1.5 text-2xs font-semibold tabular-nums',
                    toneClasses('critical').soft
                  )}
                >
                  {attention.length}
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setQuery({ sort: 'attention', view: 'active' })}
              className={railActionClass}
            >
              Sort feed
            </button>
          </div>
          {attention.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 shrink-0 text-status-ok" aria-hidden />}
              text="Nothing near breach or without an owner"
            />
          ) : (
            <ul className="space-y-1.5">
              {attention.map(item => (
                <li key={item.incident.id}>
                  <Link
                    href={`/incidents/${item.incident.id}`}
                    data-testid="attention-item"
                    data-reason={item.reason}
                    className={cn(railRowClass, 'flex items-center gap-2 p-2')}
                  >
                    <span
                      className={cn(
                        'shrink-0 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                        ATTENTION_TONE[item.tone]
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {item.incident.title}
                    </span>
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="px-4 py-3" data-testid="services-at-risk">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="dash-eyebrow">Hotspots</h3>
            <Link href="/services" className={railActionClass}>
              Services →
            </Link>
          </div>
          {services.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 shrink-0 text-status-ok" aria-hidden />}
              text="No service has active incidents"
            />
          ) : (
            <ul className="space-y-1.5">
              {services.map(service => {
                const selected = query.serviceId === service.id;
                return (
                  <li key={service.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      data-testid="service-at-risk"
                      title="Filter the live feed by this service"
                      onClick={() => setQuery({ serviceId: selected ? null : service.id })}
                      className={cn(
                        railRowClass,
                        'block w-full p-2 text-left',
                        selected && 'border-foreground/40 bg-muted'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-foreground">{service.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-2xs tabular-nums text-muted-foreground">
                          {service.critical > 0 && (
                            <span
                              className={cn(
                                'rounded-sm border px-1 text-2xs font-semibold',
                                toneClasses('critical').soft
                              )}
                            >
                              {service.critical} crit
                            </span>
                          )}
                          <span className="font-semibold text-foreground">{service.count}</span>
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                        aria-hidden
                      >
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-200',
                            toneClasses(service.critical > 0 ? 'critical' : 'elevated').solid
                          )}
                          style={{
                            width: `${Math.max(6, Math.round((service.count / max) * 100))}%`,
                          }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="px-4 py-3" data-testid="pulse-coverage">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="dash-eyebrow">On call now</h3>
            <Link href="/schedules" className={railActionClass}>
              Schedules →
            </Link>
          </div>
          {shifts.length === 0 ? (
            <EmptyLine
              icon={<AlertTriangle className="h-4 w-4 shrink-0 text-status-elevated" aria-hidden />}
              text="No active on-call shifts"
              action={{ label: 'Set up', href: '/schedules' }}
            />
          ) : (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Responders on call now">
              {shifts.slice(0, 8).map(shift => (
                <li
                  key={shift.id}
                  title={`${shift.user.name} · ${shift.scheduleName}`}
                  className="group relative"
                >
                  <UserAvatar
                    userId={shift.user.id ?? ''}
                    name={shift.user.name}
                    avatarUrl={shift.user.avatarUrl}
                    gender={shift.user.gender}
                    size="sm"
                    className="ring-2 ring-card"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-status-shift ring-2 ring-card" />
                </li>
              ))}
              {shifts.length > 8 && (
                <li className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-muted-foreground ring-2 ring-card">
                  +{shifts.length - 8}
                </li>
              )}
            </ul>
          )}
          {coverage && coverage.gaps.length > 0 && (
            <p
              data-testid="coverage-gap"
              className={cn(
                'mt-2.5 flex items-start gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium',
                toneClasses('critical').soft
              )}
            >
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {coverage.gaps.length === 1
                  ? `${coverage.gaps[0].name} has no one on call`
                  : `${coverage.gaps.length} schedules have no one on call · ${coverage.gaps
                      .slice(0, 2)
                      .map(gap => gap.name)
                      .join(', ')}${coverage.gaps.length > 2 ? '…' : ''}`}
              </span>
            </p>
          )}
        </section>
        {aiops}
      </div>
    </section>
  );
}
