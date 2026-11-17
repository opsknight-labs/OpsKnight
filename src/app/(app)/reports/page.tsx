import prisma from '@/lib/prisma';
import { DashboardVisibility } from '@prisma/client';
import Link from 'next/link';
import { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { EmptyState, PageHeader } from '@/components/patterns';
import SectionHeader from '@/components/analytics/SectionHeader';
import ReportsFilterBar, { type ReportsScope } from '@/components/reports/ReportsFilterBar';
import {
  LayoutDashboard,
  Plus,
  Sparkles,
  Terminal,
  Shield,
  Users,
  Minus,
  ArrowRight,
  SearchX,
  type LucideIcon,
} from 'lucide-react';
import { DASHBOARD_TEMPLATES } from '@/lib/reports/dashboard-templates';
import DashboardCard from '@/components/reports/DashboardCard';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reports & Dashboards | OpsKnight',
  description: 'Customizable executive reports and operational dashboards',
};

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'executive-summary': LayoutDashboard,
  'sre-operations': Terminal,
  'sla-performance': Shield,
  'team-performance': Users,
  minimal: Minus,
};

const SCOPES = ['all', 'mine', 'shared', 'templates'] as const;

function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return fields.some(field => field?.toLowerCase().includes(needle));
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; scope?: string }>;
}) {
  await requirePageAccess('/reports');
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/reports');
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      timeZone: true,
      teamMemberships: { select: { teamId: true } },
    },
  });

  if (!user) {
    redirect('/login?callbackUrl=/reports');
  }

  const userTeamIds = user.teamMemberships.map(m => m.teamId);

  // Fetch user's dashboards and shared team/public dashboards
  const [dashboards, sharedDashboards] = await Promise.all([
    prisma.dashboard.findMany({
      where: { userId: user.id, isTemplate: false },
      include: { _count: { select: { widgets: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.dashboard.findMany({
      where: {
        userId: { not: user.id },
        isTemplate: false,
        OR: [
          { visibility: DashboardVisibility.PUBLIC },
          ...(userTeamIds.length > 0
            ? [{ visibility: DashboardVisibility.TEAM, teamId: { in: userTeamIds } }]
            : []),
        ],
      },
      include: {
        _count: { select: { widgets: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const params = await searchParams;
  const query = (params?.q ?? '').trim();
  const scope: ReportsScope = SCOPES.includes(params?.scope as ReportsScope)
    ? (params?.scope as ReportsScope)
    : 'all';

  const visibleTemplates = DASHBOARD_TEMPLATES.filter(t => matches(query, t.name, t.description));
  const visibleMine = dashboards.filter(d => matches(query, d.name, d.description));
  const visibleShared = sharedDashboards.filter(d =>
    matches(query, d.name, d.description, d.user?.name, d.user?.email)
  );
  const showTemplates = scope === 'all' || scope === 'templates';
  const showMine = scope === 'all' || scope === 'mine';
  const showShared = scope === 'all' || scope === 'shared';
  const hasFilters = Boolean(query) || scope !== 'all';
  const nothingVisible =
    (!showTemplates || visibleTemplates.length === 0) &&
    (!showMine || visibleMine.length === 0) &&
    (!showShared || visibleShared.length === 0);

  const createAction = (
    <Button asChild>
      <Link href="/reports/executive/new">
        <Plus aria-hidden="true" />
        New dashboard
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Reports & Dashboards"
        icon={LayoutDashboard}
        description="Executive and operational dashboards built from reliability metrics. Start from a template or build your own."
        primaryAction={createAction}
        stats={[
          {
            label: 'My dashboards',
            value: dashboards.length,
            icon: <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Shared with me',
            value: sharedDashboards.length,
            icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            label: 'Templates',
            value: DASHBOARD_TEMPLATES.length,
            icon: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <ReportsFilterBar
        query={query}
        scope={scope}
        counts={{
          all: DASHBOARD_TEMPLATES.length + dashboards.length + sharedDashboards.length,
          mine: dashboards.length,
          shared: sharedDashboards.length,
          templates: DASHBOARD_TEMPLATES.length,
        }}
      />

      {hasFilters && nothingVisible ? (
        <EmptyState
          icon={<SearchX />}
          title="No dashboards match these filters"
          description={
            query
              ? `Nothing matched “${query}”. Try a shorter search or another scope.`
              : 'There is nothing in this scope yet.'
          }
          primaryAction={
            <Button asChild variant="outline" size="sm">
              <Link href="/reports">Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <>
          {showTemplates && visibleTemplates.length > 0 && (
            <section aria-labelledby="reports-templates" className="space-y-4">
              <SectionHeader
                id="reports-templates"
                icon={<Sparkles />}
                title="Templates"
                description="Ready-made layouts. Open one to preview it with live data, then clone it."
              />
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {visibleTemplates.map(template => {
                  const Icon = TEMPLATE_ICONS[template.id] || LayoutDashboard;
                  return (
                    <li key={template.id}>
                      <Link
                        href={`/reports/executive?template=${template.id}`}
                        className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <Card className="h-full transition-[border-color,box-shadow] duration-150 group-hover:border-ink-300 group-hover:shadow-md">
                          <CardHeader className="pb-3">
                            <div
                              aria-hidden="true"
                              className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                            >
                              <Icon className="h-5 w-5" />
                            </div>
                            <CardTitle className="text-sm font-semibold group-hover:underline">
                              {template.name}
                            </CardTitle>
                            <CardDescription className="line-clamp-2 text-xs">
                              {template.description}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {template.widgets.length} widgets
                              </span>
                              <ArrowRight
                                className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                                aria-hidden="true"
                              />
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {showMine && (
            <section aria-labelledby="reports-mine" className="space-y-4">
              <SectionHeader
                id="reports-mine"
                icon={<LayoutDashboard />}
                title="My dashboards"
                description="Dashboards you created. Only you can edit or delete them."
              />

              {visibleMine.length === 0 ? (
                query ? (
                  <p className="text-sm text-muted-foreground">
                    None of your dashboards match “{query}”.
                  </p>
                ) : (
                  <EmptyState
                    icon={<LayoutDashboard />}
                    title="No dashboards yet"
                    description="Build a dashboard from scratch, or open a template above and clone it to make it yours."
                    primaryAction={createAction}
                    secondaryAction={
                      <Button asChild variant="outline" size="sm">
                        <Link href="/reports/executive?template=executive-summary">
                          <Sparkles aria-hidden="true" />
                          Use a template
                        </Link>
                      </Button>
                    }
                  />
                )
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleMine.map(dashboard => (
                    <DashboardCard
                      key={dashboard.id}
                      id={dashboard.id}
                      name={dashboard.name}
                      description={dashboard.description}
                      widgetCount={dashboard._count.widgets}
                      isDefault={dashboard.isDefault}
                      updatedAt={dashboard.updatedAt}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {showShared && (sharedDashboards.length > 0 || scope === 'shared') && (
            <section aria-labelledby="reports-shared" className="space-y-4">
              <SectionHeader
                id="reports-shared"
                icon={<Users />}
                title="Shared with me"
                description="Dashboards your team or organization shared. You can view them; the owner edits them."
              />
              {visibleShared.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {query
                    ? `No shared dashboards match “${query}”.`
                    : 'Nobody has shared a dashboard with you yet.'}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleShared.map(dashboard => (
                    <DashboardCard
                      key={dashboard.id}
                      id={dashboard.id}
                      name={dashboard.name}
                      description={dashboard.description}
                      widgetCount={dashboard._count.widgets}
                      isDefault={dashboard.isDefault}
                      ownerName={dashboard.user?.name || dashboard.user?.email || 'Team member'}
                      visibility={dashboard.visibility}
                      canDelete={false}
                      updatedAt={dashboard.updatedAt}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
