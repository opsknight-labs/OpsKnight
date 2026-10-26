'use client';

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
      ? 'bg-muted text-foreground'
      : tone === 'amber'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : tone === 'rose'
          ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
          : tone === 'sky'
            ? 'bg-muted text-foreground'
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
          <h3 className="dash-heading-sm flex items-center gap-1.5 truncate">
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
          ? `${summary.slaDueSoon} due <10m · ${summary.slaRecentlyBreached} breached <1h`
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
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 font-semibold',
  amber: 'bg-amber-500/10 text-amber-800 dark:text-amber-400 font-semibold',
  violet: 'bg-muted text-foreground font-semibold',
};

/**
 * Ops Pulse: what needs the viewer next, beside the live feed. Every section is derived from the
 * same authorized live snapshot, so it costs no extra queries.
 */
export function OpsPulsePanel() {
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
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border/80 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-primary/20"
          >
            <Activity className="h-3.5 w-3.5" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 ring-1 ring-card" />
            </span>
          </span>
          <div className="min-w-0">
            <h2 id="ops-pulse-heading" className="dash-heading whitespace-nowrap">
              Ops Pulse
            </h2>
            <p className="truncate text-xs text-muted-foreground">What needs you next</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          LIVE
        </span>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
        <section className="px-4 py-3" data-testid="pulse-you">
          <div
            className={cn(
              'rounded-xl p-3 border shadow-2xs transition-all',
              coverage?.me.onCall
                ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-950/30 dark:via-emerald-900/10'
                : 'border-border/70 bg-muted/20'
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-2xs',
                  coverage?.me.onCall
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/30'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <UserRound className="h-4 w-4" />
                {coverage?.me.onCall && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">
                  {coverage?.me.onCall
                    ? `You're on call · ${coverage.me.schedules.join(', ')}`
                    : 'Not on call'}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {coverage?.me.onCall ? `${formatUntil(coverage.me.until, now)} · ` : ''}
                  {mine === 0 ? 'Your queue is clear' : `${mine} in your queue`}
                </p>
              </div>
              <Link
                href={queueHref}
                className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
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
                <span className="rounded-full bg-rose-500/15 px-1.5 text-[10px] font-bold text-rose-700 dark:text-rose-300 font-mono">
                  {attention.length}
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setQuery({ sort: 'attention', view: 'active' })}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Sort feed
            </button>
          </div>
          {attention.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
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
                    className="group flex items-center gap-2 rounded-lg border border-border/70 bg-card p-2 hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-muted/40 shadow-2xs outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <span
                      className={cn(
                        'shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums shadow-2xs',
                        ATTENTION_TONE[item.tone]
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.incident.title}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="px-4 py-3" data-testid="services-at-risk">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="dash-eyebrow">Hotspots</h3>
            <Link
              href="/services"
              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Services →
            </Link>
          </div>
          {services.length === 0 ? (
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
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
                        'group block w-full rounded-lg border p-2 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/50 shadow-2xs',
                        selected
                          ? 'border-primary/50 bg-primary/10 shadow-xs'
                          : 'border-border/60 bg-card hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-muted/30'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate font-semibold text-foreground group-hover:text-primary transition-colors">
                          {service.name}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground flex items-center gap-1.5">
                          {service.critical > 0 && (
                            <span className="rounded bg-rose-500/15 px-1 py-0.2 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                              {service.critical} crit
                            </span>
                          )}
                          <span className="font-semibold text-foreground">{service.count}</span>
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/80"
                        aria-hidden
                      >
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-300',
                            service.critical > 0
                              ? 'bg-gradient-to-r from-rose-500 to-rose-400'
                              : 'bg-gradient-to-r from-amber-500 to-amber-400'
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
            <Link
              href="/schedules"
              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Schedules →
            </Link>
          </div>
          {shifts.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No active on-call shifts</p>
          ) : (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Responders on call now">
              {shifts.slice(0, 8).map(shift => (
                <li key={shift.id} title={`${shift.user.name} · ${shift.scheduleName}`} className="group relative">
                  <UserAvatar
                    userId={shift.user.id ?? ''}
                    name={shift.user.name}
                    avatarUrl={shift.user.avatarUrl}
                    gender={shift.user.gender}
                    size="sm"
                    className="ring-2 ring-card shadow-2xs transition-transform group-hover:scale-105"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
                </li>
              ))}
              {shifts.length > 8 && (
                <li className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground ring-2 ring-card shadow-2xs">
                  +{shifts.length - 8}
                </li>
              )}
            </ul>
          )}
          {coverage && coverage.gaps.length > 0 && (
            <p
              data-testid="coverage-gap"
              className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
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
      </div>
    </section>
  );
}
