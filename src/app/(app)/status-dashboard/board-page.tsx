import { Suspense } from 'react';
import Link from 'next/link';
import { Boxes, MonitorCheck } from 'lucide-react';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import {
  canManageStatusDashboards,
  listStatusDashboards,
  loadStatusBoard,
  orUnavailable,
} from '@/lib/business-services/dashboards';
import FreshnessControl from '@/components/analytics/FreshnessControl';
import { EmptyState, PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import AutoRefresh from '@/components/business-service/AutoRefresh';
import HealthUnavailable from '@/components/business-service/HealthUnavailable';
import StatusBoard from '@/components/business-service/StatusBoard';
import StatusDashboardManager from '@/components/business-service/StatusDashboardManager';
import { isImpacted } from '@/components/business-service/catalog-model';
import { cn } from '@/lib/utils';

/**
 * Shared body of /status-dashboard (every visible business service) and /status-dashboard/[slug]
 * (a custom board). Re-renders every 30 s while visible.
 */
export default async function StatusBoardPage({
  actor,
  dashboard,
}: {
  actor: AuthorizationActor;
  dashboard: { id: string; name: string; slug: string } | null;
}) {
  const canManage = canManageStatusDashboards(actor);
  const [dashboards, choices, board] = await Promise.all([
    listStatusDashboards(actor),
    canManage
      ? prisma.businessService.findMany({
          where: businessServiceReadWhere(actor),
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    orUnavailable(
      loadStatusBoard(actor, { dashboardId: dashboard?.id }),
      'business_services.board.unavailable'
    ),
  ]);

  const impacted = board?.tiles.filter(tile => isImpacted(tile.health.status)).length;
  const maintenance = board?.tiles.filter(tile => tile.health.status === 'MAINTENANCE').length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <AutoRefresh seconds={30} />
      <PageHeader
        eyebrow="Internal Status"
        title={dashboard?.name ?? 'Status dashboard'}
        icon={MonitorCheck}
        breadcrumbs={
          dashboard
            ? [{ label: 'Status dashboard', href: '/status-dashboard' }, { label: dashboard.name }]
            : undefined
        }
        description="How the business services your company relies on are doing right now. Updates every 30 seconds."
        stats={
          board
            ? [
                { label: 'Business services', value: board.tiles.length.toLocaleString() },
                { label: 'Impacted', value: (impacted ?? 0).toLocaleString() },
                { label: 'In maintenance', value: (maintenance ?? 0).toLocaleString() },
              ]
            : undefined
        }
        primaryAction={
          canManage ? (
            <StatusDashboardManager
              dashboards={dashboards}
              businessServices={choices}
              triggerClassName={pageHeaderActionClass}
            />
          ) : undefined
        }
      />

      {dashboards.length > 0 && (
        <nav aria-label="Status dashboards" className="-mx-1 overflow-x-auto">
          <ul className="flex gap-1 px-1">
            {[{ name: 'All business services', slug: '' }, ...dashboards].map(entry => {
              const current = (dashboard?.slug ?? '') === entry.slug;
              return (
                <li key={entry.slug || 'all'}>
                  <Link
                    href={entry.slug ? `/status-dashboard/${entry.slug}` : '/status-dashboard'}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                      current
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {entry.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {board && (
        <Suspense fallback={<div className="h-11 sm:h-5" aria-hidden />}>
          <FreshnessControl asOf={board.computedAt.toISOString()} invalidate={false} />
        </Suspense>
      )}

      {!board ? (
        <HealthUnavailable message="The board could not load live status. It refreshes on its own every 30 seconds." />
      ) : board.tiles.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Boxes className="h-6 w-6" aria-hidden />}
          title={dashboard ? 'Nothing on this dashboard for you' : 'No business services to show'}
          description={
            dashboard
              ? 'This board has no business services, or none you can see. Ask its owner, or open the board of all business services.'
              : 'Business services name what customers rely on, like Checkout. Once one exists it appears here with its live status.'
          }
          action={
            dashboard ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/status-dashboard">All business services</Link>
              </Button>
            ) : canManage ? (
              <Button asChild size="sm">
                <Link href="/services/business/new">Create a business service</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <StatusBoard tiles={board.tiles} notices={board.notices} now={board.computedAt} />
      )}
    </div>
  );
}
