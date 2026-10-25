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
import SidebarWidget, { WIDGET_ICON_BG } from '@/components/dashboard/SidebarWidget';
import UserAvatar from '@/components/UserAvatar';
import { buildIncidentListHref } from '@/lib/incident-links';
import {
  formatIncidentAge,
  isCriticalIncident,
  type LiveIncident,
} from '@/lib/dashboard/live-incidents-shared';
import { useLiveDashboard } from './LiveDashboardProvider';
import { SlaChip } from './LiveIncidentRow';

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

export function MyQueueCard() {
  const { snapshot, now, currentUserId } = useLiveDashboard();
  const items = snapshot?.rail.myQueue ?? [];
  const count = snapshot?.summary.mine ?? 0;
  return (
    <SidebarWidget
      title={`My Queue${count ? ` · ${count}` : ''}`}
      subtitle="Assigned to you, critical first"
      iconBg={WIDGET_ICON_BG.purple}
      icon={<UserRound className="h-4 w-4" />}
      actions={[
        {
          label: 'View all',
          href: buildIncidentListHref({ filter: 'all_open', assignee: currentUserId }),
        },
      ]}
    >
      <div className="space-y-1.5" data-testid="rail-my-queue">
        {items.length === 0 ? (
          <EmptyLine
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
            text="Your queue is clear"
          />
        ) : (
          items.map(incident => (
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
      </div>
    </SidebarWidget>
  );
}

export function SlaRiskCard() {
  const { snapshot, now, setQuery } = useLiveDashboard();
  const items = snapshot?.rail.slaRisk ?? [];
  const summary = snapshot?.summary;
  return (
    <SidebarWidget
      title="SLA at Risk"
      subtitle={
        summary
          ? `${summary.slaBreached} breached · ${summary.slaAtRisk - summary.slaBreached} approaching`
          : 'Acknowledge and resolve targets'
      }
      iconBg={WIDGET_ICON_BG.orange}
      icon={<Clock3 className="h-4 w-4" />}
      actions={[{ label: 'Show all', onClick: () => setQuery({ view: 'breaching' }) }]}
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
    </SidebarWidget>
  );
}

export function OnCallCard() {
  const { snapshot } = useLiveDashboard();
  const shifts = snapshot?.rail.onCall ?? [];
  return (
    <SidebarWidget
      title="On-Call Now"
      subtitle={
        shifts.length ? `${shifts.length} active shift${shifts.length === 1 ? '' : 's'}` : undefined
      }
      iconBg={WIDGET_ICON_BG.purple}
      icon={<Users className="h-4 w-4" />}
      actions={[{ label: 'Schedules', href: '/schedules' }]}
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
          shifts.slice(0, 4).map(shift => (
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
    </SidebarWidget>
  );
}

export function ActivityCard() {
  const { snapshot, now } = useLiveDashboard();
  const items = snapshot?.rail.activity ?? [];
  return (
    <SidebarWidget
      title="Recent Activity"
      subtitle="Acks, escalations and resolutions"
      iconBg={WIDGET_ICON_BG.slate}
      icon={<Activity className="h-4 w-4" />}
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
    </SidebarWidget>
  );
}

export function ServicesAtRiskCard() {
  const { snapshot, query, setQuery } = useLiveDashboard();
  const services = (snapshot?.rail.servicesAtRisk ?? []).slice(0, 6);
  const max = Math.max(1, ...services.map(service => service.count));
  return (
    <SidebarWidget
      title="Services at Risk"
      subtitle="Click a service to filter the live feed"
      iconBg={WIDGET_ICON_BG.red}
      icon={<Server className="h-4 w-4" />}
      actions={[{ label: 'All services', href: '/services' }]}
    >
      <ul className="space-y-1" data-testid="services-at-risk">
        {services.length === 0 ? (
          <li>
            <EmptyLine
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
              text="No service has active incidents"
            />
          </li>
        ) : (
          services.map(service => {
            const selected = query.serviceId === service.id;
            return (
              <li key={service.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  data-testid="service-at-risk"
                  onClick={() => setQuery({ serviceId: selected ? null : service.id })}
                  className={cn(
                    'w-full rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
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
                          {service.critical} critical
                        </span>
                      )}
                      <span className="font-semibold text-muted-foreground">
                        {service.count} active
                      </span>
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
              </li>
            );
          })
        )}
      </ul>
    </SidebarWidget>
  );
}
