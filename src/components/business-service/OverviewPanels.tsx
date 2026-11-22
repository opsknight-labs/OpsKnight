import type { ReactNode } from 'react';
import Link from 'next/link';
import type { BusinessServiceTier, IncidentStatus, IncidentUrgency } from '@prisma/client';
import { ArrowUpRight, Boxes, LayoutPanelTop, Network, Users } from 'lucide-react';
import { KPI_CARD, KPI_GRID, KpiBody } from '@/components/analytics/KpiCard';
import { EmptyState, RelativeTime, SeverityBadge, StatusBadge } from '@/components/patterns';
import type { BsStatus, BusinessServiceStats } from '@/lib/business-services/contract';
import { cn } from '@/lib/utils';
import DependencyMiniGraph from './DependencyMiniGraph';
import HealthBadge, { CRITICALITY_LABEL } from './HealthBadge';

const head = 'h-9 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const cell = 'px-3 py-2.5 align-middle text-sm font-normal';
const row = 'border-t border-border transition-colors hover:bg-muted/50';
const link =
  'font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

function Subheading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────────────────────────

const percent = (value: number) =>
  `${value >= 99.995 ? '100' : value.toFixed(value >= 99 ? 2 : 1)}%`;

function duration(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)}h` : `${Math.round(hours / 24)}d`;
}

/** Uptime 30/90 days, incidents, MTTA and MTTR over the last 30 days. */
export function OverviewKpis({
  last30,
  last90,
}: {
  last30: BusinessServiceStats;
  last90: BusinessServiceStats;
}) {
  return (
    <ul className={KPI_GRID} aria-label="Key metrics">
      <li className={KPI_CARD}>
        <KpiBody
          label="Uptime, 30 days"
          value={percent(last30.uptimePercent)}
          meta={<span className="tabular-nums">90 days: {percent(last90.uptimePercent)}</span>}
        />
      </li>
      <li className={KPI_CARD}>
        <KpiBody
          label="Incidents, 30 days"
          value={last30.incidentCount.toLocaleString()}
          meta={
            <span className="tabular-nums">
              {Math.round(last30.impactMinutes).toLocaleString()} min of impact
            </span>
          }
        />
      </li>
      <li className={KPI_CARD}>
        <KpiBody
          label="MTTA"
          value={duration(last30.mttaMinutes)}
          empty={last30.mttaMinutes === null}
          meta={
            last30.mttaMinutes === null ? 'No incidents to measure' : 'Mean time to acknowledge'
          }
        />
      </li>
      <li className={KPI_CARD}>
        <KpiBody
          label="MTTR"
          value={duration(last30.mttrMinutes)}
          empty={last30.mttrMinutes === null}
          meta={last30.mttrMinutes === null ? 'No incidents to measure' : 'Mean time to resolve'}
        />
      </li>
    </ul>
  );
}

// ── Incidents ────────────────────────────────────────────────────────────────────────────────────

export type OverviewIncident = {
  id: string;
  title: string;
  status: IncidentStatus;
  urgency: IncidentUrgency;
  serviceName: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

/** Active then recent incidents the viewer can read. */
export function OverviewIncidents({ incidents }: { incidents: readonly OverviewIncident[] }) {
  if (!incidents.length) {
    return (
      <EmptyState
        variant="simple"
        size="sm"
        title="No incidents in the last 30 days"
        description="Incidents on this business service's services, or marked as impacting it, show up here."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {incidents.map(incident => (
        <li
          key={incident.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5"
        >
          <StatusBadge status={incident.status} size="xs" />
          <SeverityBadge urgency={incident.urgency} size="xs" />
          <Link href={`/incidents/${incident.id}`} className={cn(link, 'min-w-0 flex-1 truncate')}>
            {incident.title}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {incident.serviceName} ·{' '}
            <RelativeTime date={incident.resolvedAt ?? incident.createdAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Stakeholders see how many, never which. */
export function OverviewIncidentCounts({ open, last30 }: { open: number; last30: number | null }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border">
      <div className="bg-card px-4 py-3">
        <dt className="text-xs font-medium text-muted-foreground">Open incidents</dt>
        <dd className="font-display text-2xl font-semibold tabular-nums">{open}</dd>
      </div>
      <div className="bg-card px-4 py-3">
        <dt className="text-xs font-medium text-muted-foreground">Incidents, 30 days</dt>
        <dd className="font-display text-2xl font-semibold tabular-nums">{last30 ?? '—'}</dd>
      </div>
    </dl>
  );
}

// ── Members ──────────────────────────────────────────────────────────────────────────────────────

export type OverviewMember = {
  id: string;
  name: string;
  critical: boolean;
  teamName: string | null;
  /** The viewer can open the service page. */
  canOpen: boolean;
  /** Null while health is being prepared. */
  status: BsStatus | null;
};

export type OverviewRelated = {
  id: string;
  name: string;
  criticality: BusinessServiceTier | null;
  status: BsStatus | null;
};

function RelatedList({
  items,
  empty,
  label,
}: {
  items: readonly OverviewRelated[];
  empty: string;
  label: string;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border rounded-md border" aria-label={label}>
      {items.map(item => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
          <Link href={`/services/business/${item.id}`} className={cn(link, 'min-w-0 truncate')}>
            {item.name}
          </Link>
          {item.criticality && (
            <span className="text-xs text-muted-foreground">
              {CRITICALITY_LABEL[item.criticality]}
            </span>
          )}
          <span className="ml-auto">
            {item.status ? <HealthBadge status={item.status} /> : <Pending />}
          </span>
        </li>
      ))}
    </ul>
  );
}

const Pending = () => <span className="text-xs text-muted-foreground">Health pending</span>;

export function MembersPanel({
  members,
  supporting,
}: {
  members: readonly OverviewMember[];
  supporting: readonly OverviewRelated[];
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="bs-members" className="space-y-2">
        <Subheading id="bs-members">Technical services</Subheading>
        {members.length === 0 ? (
          <EmptyState
            variant="simple"
            size="sm"
            icon={<Boxes className="h-5 w-5" aria-hidden />}
            title="No technical services yet"
            description="Add the services behind this capability so its health follows their incidents."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Technical services and their status</caption>
              <thead>
                <tr>
                  <th scope="col" className={head}>
                    Service
                  </th>
                  <th scope="col" className={head}>
                    Status
                  </th>
                  <th scope="col" className={head}>
                    Drives health
                  </th>
                  <th scope="col" className={cn(head, 'hidden sm:table-cell')}>
                    Team
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map(member => (
                  <tr key={member.id} className={row}>
                    <td className={cell}>
                      {member.canOpen ? (
                        <Link href={`/services/${member.id}`} className={link}>
                          {member.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{member.name}</span>
                      )}
                    </td>
                    <td className={cell}>
                      {member.status ? <HealthBadge status={member.status} /> : <Pending />}
                    </td>
                    <td className={cn(cell, 'text-muted-foreground')}>
                      {member.critical ? 'Critical' : 'Informational'}
                    </td>
                    <td className={cn(cell, 'hidden text-muted-foreground sm:table-cell')}>
                      {member.teamName ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Only critical services change this business service&apos;s health. Informational ones are
          shown for context.
        </p>
      </section>
      <section aria-labelledby="bs-supporting" className="space-y-2">
        <Subheading id="bs-supporting">Supporting business services</Subheading>
        <RelatedList
          items={supporting}
          label="Supporting business services"
          empty="No other business service supports this one."
        />
      </section>
    </div>
  );
}

// ── Dependencies ─────────────────────────────────────────────────────────────────────────────────

export type OverviewTechnicalDependency = {
  id: string;
  name: string;
  /** Member services that depend on it. */
  usedBy: string[];
};

export function DependenciesPanel({
  businessServiceId,
  supporting,
  dependents,
  technical,
}: {
  businessServiceId: string;
  supporting: readonly OverviewRelated[];
  dependents: readonly OverviewRelated[];
  technical: readonly OverviewTechnicalDependency[];
}) {
  return (
    <div className="space-y-6">
      <DependencyMiniGraph businessServiceId={businessServiceId} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="bs-depends-on" className="space-y-2">
          <Subheading id="bs-depends-on">Depends on</Subheading>
          <RelatedList
            items={supporting}
            label="Business services this one depends on"
            empty="Depends on no other business service."
          />
        </section>
        <section aria-labelledby="bs-depended-by" className="space-y-2">
          <Subheading id="bs-depended-by">Relied on by</Subheading>
          <RelatedList
            items={dependents}
            label="Business services that rely on this one"
            empty="No other business service relies on this one."
          />
        </section>
      </div>
      <section aria-labelledby="bs-technical" className="space-y-2">
        <Subheading id="bs-technical">Upstream technical services</Subheading>
        {technical.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No confirmed dependencies outside this business service&apos;s own services.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border" aria-label="Upstream services">
            {technical.map(dependency => (
              <li
                key={dependency.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
              >
                <Network className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link href={`/services/${dependency.id}`} className={link}>
                  {dependency.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  used by {dependency.usedBy.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          An incident on a dependency up to three hops away can degrade this business service.
        </p>
      </section>
    </div>
  );
}

// ── Status pages ─────────────────────────────────────────────────────────────────────────────────

export type OverviewStatusPage = {
  id: string;
  pageId: string;
  name: string;
  /** Internal view of the page; null when the page is off. */
  href: string | null;
  displayName: string | null;
  showOnPage: boolean;
  showMembers: boolean;
  grouped: boolean;
  override: BsStatus | null;
  overrideUntil: Date | null;
};

export function StatusPagesPanel({
  pages,
  canManage,
}: {
  pages: readonly OverviewStatusPage[];
  canManage: boolean;
}) {
  if (!pages.length) {
    return (
      <EmptyState
        variant="simple"
        size="sm"
        icon={<LayoutPanelTop className="h-5 w-5" aria-hidden />}
        title="Not on a status page"
        description="Add this business service to a status page to show customers its health as one component group."
        action={
          canManage ? (
            <Link href="/settings/status-pages" className={cn(link, 'text-sm underline')}>
              Open status pages
            </Link>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Status pages that show this business service</caption>
        <thead>
          <tr>
            <th scope="col" className={head}>
              Status page
            </th>
            <th scope="col" className={head}>
              Shown as
            </th>
            <th scope="col" className={head}>
              Layout
            </th>
            <th scope="col" className={head}>
              Override
            </th>
          </tr>
        </thead>
        <tbody>
          {pages.map(page => (
            <tr key={page.id} className={row}>
              <td className={cell}>
                <span className="flex flex-wrap items-center gap-2">
                  {page.href ? (
                    <Link href={page.href} className={link}>
                      {page.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{page.name}</span>
                  )}
                  {!page.href && <span className="text-xs text-muted-foreground">Off</span>}
                  {canManage && (
                    <Link
                      href={`/settings/status-pages/${page.pageId}`}
                      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Configure
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </Link>
                  )}
                </span>
              </td>
              <td className={cell}>
                {page.showOnPage ? (
                  (page.displayName ?? <span className="text-muted-foreground">Own name</span>)
                ) : (
                  <span className="text-muted-foreground">Hidden</span>
                )}
              </td>
              <td className={cn(cell, 'text-muted-foreground')}>
                {page.grouped ? 'Component group' : 'Flat list'}
                {page.showMembers ? ', services listed' : ', services hidden'}
              </td>
              <td className={cell}>
                {page.override ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <HealthBadge status={page.override} />
                    {page.overrideUntil && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        until <RelativeTime date={page.overrideUntil} />
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Live health</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Followers & subscribers ──────────────────────────────────────────────────────────────────────

export function FollowersPanel({
  followers,
  teams,
  dashboards,
  followAction,
}: {
  followers: readonly { id: string; name: string }[];
  teams: readonly { id: string; name: string }[];
  dashboards: readonly { name: string; slug: string }[];
  followAction?: ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section aria-labelledby="bs-followers" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Subheading id="bs-followers">
            Followers <span className="tabular-nums">({followers.length})</span>
          </Subheading>
          {followAction}
        </div>
        {followers.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {followers.map(user => (
              <li key={user.id} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs">
                {user.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nobody follows this yet. Followers get plain-language updates when it is impacted.
          </p>
        )}
      </section>
      <section aria-labelledby="bs-teams" className="space-y-2">
        <Subheading id="bs-teams">
          Subscribed teams <span className="tabular-nums">({teams.length})</span>
        </Subheading>
        {teams.length ? (
          <ul className="space-y-1 text-sm">
            {teams.map(team => (
              <li key={team.id} className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {team.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No team subscribes to updates.</p>
        )}
      </section>
      <section aria-labelledby="bs-dashboards" className="space-y-2">
        <Subheading id="bs-dashboards">On status dashboards</Subheading>
        <ul className="space-y-1 text-sm">
          <li>
            <Link href="/status-dashboard" className={link}>
              All business services
            </Link>
          </li>
          {dashboards.map(dashboard => (
            <li key={dashboard.slug}>
              <Link href={`/status-dashboard/${dashboard.slug}`} className={link}>
                {dashboard.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
