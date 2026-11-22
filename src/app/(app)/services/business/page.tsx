import Link from 'next/link';
import { Boxes, Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { BUSINESS_SERVICE_SELECT, businessServiceReadWhere } from '@/lib/business-services/commands';
import { PageHeader, EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import BusinessServiceFollowButton from '@/components/service/BusinessServiceFollowButton';
import BusinessServiceStatusPill from '@/components/service/BusinessServiceStatusPill';
import { getBusinessServiceHealth } from '@/lib/business-services/contract';

export const revalidate = 0;

export default async function BusinessServicesPage() {
  await requirePageAccess('/services/business');
  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);
  const businessServices = await prisma.businessService.findMany({
    where: businessServiceReadWhere(actor),
    orderBy: { name: 'asc' },
    select: BUSINESS_SERVICE_SELECT,
  });
  const health = await getBusinessServiceHealth(
    businessServices.map(item => item.id),
    actor
  );
  const statusOf = (id: string) => health.get(id)?.status ?? 'OPERATIONAL';
  const canManage = permissions.isResponderOrAbove;
  const affected = businessServices.filter(
    item => !['OPERATIONAL', 'UNKNOWN', 'MAINTENANCE'].includes(statusOf(item.id))
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Service catalog"
        title="Business services"
        icon={Boxes}
        breadcrumbs={[{ label: 'Services', href: '/services' }, { label: 'Business services' }]}
        description="Group technical services into what customers rely on, like Checkout or Payments. Status pages can show them, and followers hear when they are affected."
        stats={[
          { label: 'Business services', value: businessServices.length },
          { label: 'Affected now', value: affected },
        ]}
        primaryAction={
          canManage ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/services/business/new">
                <Plus className="h-4 w-4" aria-hidden />
                New business service
              </Link>
            </Button>
          ) : undefined
        }
      />

      {businessServices.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" aria-hidden />}
          title="No business services yet"
          description="Name a capability customers depend on and pick the technical services behind it. Its status follows open incidents on them and on what they depend on."
          action={
            canManage ? (
              <Button asChild size="sm">
                <Link href="/services/business/new">Create the first one</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
          {businessServices.map(item => {
            const status = statusOf(item.id);
            const following = item.followers.some(follower => follower.user.id === actor.id);
            const shown = item.members.slice(0, 4);
            return (
              <li
                key={item.id}
                className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto] lg:items-center"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {canManage ? (
                      <Link
                        href={`/services/business/${item.id}`}
                        className="truncate text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-semibold">{item.name}</span>
                    )}
                    <BusinessServiceStatusPill status={status} />
                  </div>
                  {item.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {[
                      item.tier,
                      item.ownerTeam ? `Owned by ${item.ownerTeam.name}` : null,
                      `${item.followers.length} ${item.followers.length === 1 ? 'follower' : 'followers'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={`${item.name} services`}>
                  {item.members.length === 0 && (
                    <li className="text-xs text-muted-foreground">No technical services yet</li>
                  )}
                  {shown.map(({ service }) => (
                    <li key={service.id}>
                      <Link
                        href={`/services/${service.id}`}
                        className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <BusinessServiceStatusPill status={service.status} dotOnly />
                        {service.name}
                      </Link>
                    </li>
                  ))}
                  {item.members.length > shown.length && (
                    <li className="inline-flex h-6 items-center px-1 text-xs text-muted-foreground tabular-nums">
                      +{item.members.length - shown.length} more
                    </li>
                  )}
                </ul>
                <div className="flex items-center gap-2 lg:justify-end">
                  <BusinessServiceFollowButton id={item.id} name={item.name} following={following} />
                  {canManage && (
                    <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
                      <Link href={`/services/business/${item.id}`}>Edit</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
