'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock3,
  Server,
  UserRound,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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

/** Compact, consistent card used across the rail, the cockpit and the wallboard. */
function RailCard({
  title,
  count,
  subtitle,
  icon,
  tone,
  action,
  grow = false,
  testId,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  icon: React.ReactNode;
  tone: 'violet' | 'amber' | 'rose' | 'slate' | 'sky';
  action?: RailAction;
  grow?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'violet'
      ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
      : tone === 'amber'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
        : tone === 'rose'
          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
          : tone === 'sky'
            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
            : 'bg-muted text-muted-foreground';
  const actionClass =
    'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
  return (
    <section
      data-testid={testId}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.05)]',
        grow ? 'xl:min-h-[9rem] xl:flex-1' : 'shrink-0'
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/70 px-3 py-2">
        <span
          aria-hidden
          className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', toneClass)}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-foreground">
            {title}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </h3>
          {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {action &&
          (action.href ? (
            <Link href={action.href} className={actionClass}>
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className={actionClass}>
              {action.label}
            </button>
          ))}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
    </section>
  );
}

function EmptyLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      {icon}
      {text}
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
      className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 hover:border-border hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          isCriticalIncident(incident) ? 'bg-rose-500' : 'bg-amber-500'
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground group-hover:text-primary">
          {incident.title}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
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
          ? `${summary.slaBreached} breached · ${summary.slaAtRisk - summary.slaBreached} approaching`
          : 'Acknowledge and resolve targets'
      }
      tone="amber"
      icon={<Clock3 className="h-3.5 w-3.5" />}
      action={{ label: 'Show all', onClick: () => setQuery({ view: 'breaching' }) }}
      grow={grow}
      testId="rail-sla-card"
    >
      <div className="space-y-1.5" data-testid="rail-sla-risk">
        {items.length === 0 ? (
          <EmptyLine
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
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
      tone="sky"
      icon={<Users className="h-3.5 w-3.5" />}
      action={{ label: 'Schedules', href: '/schedules' }}
    >
      <ul className="space-y-0.5" data-testid="rail-on-call" aria-label="Active on-call shifts">
        {shifts.length === 0 ? (
          <li>
            <EmptyLine
              icon={<AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />}
              text="No active on-call shifts"
            />
          </li>
        ) : (
          shifts.slice(0, 3).map(shift => (
            <li key={shift.id}>
              <Link
                href="/schedules"
                className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="relative shrink-0">
                  <UserAvatar
                    userId={shift.user.id ?? ''}
                    name={shift.user.name}
                    avatarUrl={shift.user.avatarUrl}
                    gender={shift.user.gender}
                    size="xs"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">
                    {shift.user.name}
                  </span>
                  <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
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

export function ActivityCard() {
  const { snapshot, now } = useLiveDashboard();
  const items = snapshot?.rail.activity ?? [];
  return (
    <RailCard
      title="Recent Activity"
      subtitle="Acks, escalations and resolutions"
      tone="slate"
      icon={<Activity className="h-3.5 w-3.5" />}
    >
      <ol className="relative space-y-2 border-l border-border pl-3" data-testid="rail-activity">
        {items.length === 0 ? (
          <li className="text-xs text-muted-foreground">No recent activity</li>
        ) : (
          items.slice(0, 6).map(item => (
            <li key={item.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full border-2 border-card bg-primary/70"
              />
              <Link
                href={`/incidents/${item.incidentId}`}
                className="block rounded outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="block truncate text-[11px] text-foreground" title={item.message}>
                  {item.message}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {item.incidentTitle} · {formatIncidentAge(item.createdAt, now)}
                </span>
              </Link>
            </li>
          ))
        )}
      </ol>
    </RailCard>
  );
}

function PulseSection({
  title,
  count,
  action,
  children,
  testId,
}: {
  title: string;
  count?: number;
  action?: RailAction;
  children: React.ReactNode;
  testId: string;
}) {
  const actionClass =
    'rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
  return (
    <section className="px-3 py-2.5" data-testid={testId}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-foreground">
              {count}
            </span>
          )}
        </h4>
        {action &&
          (action.href ? (
            <Link href={action.href} className={actionClass}>
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className={actionClass}>
              {action.label}
            </button>
          ))}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/**
 * Ops Pulse: the signals a responder acts on next, beside the live feed. Every section is
 * derived from the same authorized live snapshot, so it costs no extra queries.
 */
export function OpsPulsePanel() {
  const { snapshot, now, currentUserId, query, setQuery } = useLiveDashboard();
  const summary = snapshot?.summary;
  const queue = (snapshot?.rail.myQueue ?? []).slice(0, 3);
  const slaRisk = (snapshot?.rail.slaRisk ?? []).slice(0, 4);
  const services = (snapshot?.rail.servicesAtRisk ?? []).slice(0, 5);
  const max = Math.max(1, ...services.map(service => service.count));

  return (
    <section
      aria-labelledby="ops-pulse-heading"
      data-testid="ops-pulse"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <Activity className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="ops-pulse-heading" className="text-[15px] font-semibold text-foreground">
            Ops Pulse
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            Signals that need attention right now
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
        <PulseSection
          title="My Queue"
          count={summary?.mine ?? 0}
          testId="rail-my-queue"
          action={{
            label: 'View all',
            href: buildIncidentListHref({ filter: 'all_open', assignee: currentUserId }),
          }}
        >
          {queue.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
              text="Your queue is clear"
            />
          ) : (
            queue.map(incident => (
              <IncidentLine
                key={incident.id}
                incident={incident}
                now={now}
                trailing={
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {incident.status === 'OPEN' ? 'Triggered' : 'Ack'}
                  </span>
                }
              />
            ))
          )}
        </PulseSection>
        <PulseSection
          title="SLA at Risk"
          count={summary?.slaAtRisk ?? 0}
          testId="rail-sla-risk"
          action={{ label: 'Show all', onClick: () => setQuery({ view: 'breaching' }) }}
        >
          {slaRisk.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
              text="Everything is within SLA"
            />
          ) : (
            slaRisk.map(incident => (
              <IncidentLine
                key={incident.id}
                incident={incident}
                now={now}
                trailing={<SlaChip incident={incident} now={now} />}
              />
            ))
          )}
        </PulseSection>
        <PulseSection
          title="Services at Risk"
          count={snapshot?.rail.servicesAtRisk.length ?? 0}
          testId="services-at-risk"
          action={{ label: 'All services', href: '/services' }}
        >
          {services.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
              text="No service has active incidents"
            />
          ) : (
            services.map(service => {
              const selected = query.serviceId === service.id;
              return (
                <button
                  key={service.id}
                  type="button"
                  aria-pressed={selected}
                  data-testid="service-at-risk"
                  title="Filter the live feed by this service"
                  onClick={() => setQuery({ serviceId: selected ? null : service.id })}
                  className={cn(
                    'block w-full rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
                    selected ? 'bg-primary/10' : 'hover:bg-muted/60'
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {service.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
                      {service.critical > 0 && (
                        <span className="rounded bg-rose-500/10 px-1 font-bold text-rose-700 dark:text-rose-300">
                          {service.critical} crit
                        </span>
                      )}
                      <span className="font-semibold text-muted-foreground">{service.count}</span>
                    </span>
                  </span>
                  <span
                    className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        service.critical > 0 ? 'bg-rose-500' : 'bg-amber-500'
                      )}
                      style={{ width: `${Math.max(6, Math.round((service.count / max) * 100))}%` }}
                    />
                  </span>
                </button>
              );
            })
          )}
        </PulseSection>
      </div>
    </section>
  );
}
