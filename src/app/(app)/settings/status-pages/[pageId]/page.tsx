import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { Globe, Layers, Users, Megaphone, Key, ExternalLink } from 'lucide-react';
import StatusPageConfig from '@/components/StatusPageConfig';
import { getStatusPageSnapshot, buildStatusPageSnapshot } from '@/lib/status-pages/snapshot';

export default async function StatusPageWorkspace({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) redirect('/login');
  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }

  const { pageId } = await params;
  const [statusPage, allServices, liveSnapshotResult] = await Promise.all([
    prisma.statusPage.findUnique({
      where: { id: pageId },
      include: {
        services: { include: { service: true } },
        announcements: { orderBy: { startDate: 'desc' }, take: 20 },
        apiTokens: { orderBy: { createdAt: 'desc' }, take: 50 },
        _count: {
          select: {
            subscriptions: { where: { verified: true, unsubscribedAt: null } },
          },
        },
      },
    }),
    prisma.service.findMany({ orderBy: { name: 'asc' } }),
    getStatusPageSnapshot(pageId).catch(() => null),
  ]);
  if (!statusPage) notFound();

  const liveSnapshot =
    liveSnapshotResult?.snapshot ??
    (await buildStatusPageSnapshot(pageId, 'preview').catch(() => null));

  const formattedStatusPage = {
    ...statusPage,
    allowedCustomFields: Array.isArray(statusPage.allowedCustomFields)
      ? statusPage.allowedCustomFields.filter((value): value is string => typeof value === 'string')
      : [],
    announcements: statusPage.announcements.map(announcement => ({
      ...announcement,
      startDate: announcement.startDate.toISOString(),
      endDate: announcement.endDate?.toISOString() || null,
      affectedServiceIds: Array.isArray(announcement.affectedServiceIds)
        ? (announcement.affectedServiceIds as string[])
        : null,
    })),
    apiTokens: statusPage.apiTokens.map(token => ({
      ...token,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() || null,
      revokedAt: token.revokedAt?.toISOString() || null,
    })),
  };
  const publicHref = `/status${statusPage.slug ? `/${statusPage.slug}` : ''}`;
  const visibleServicesCount = statusPage.services.filter(s => s.showOnPage).length;
  const subscriberCount = statusPage._count.subscriptions;

  return (
    <div className="space-y-5">
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: statusPage.name,
        }}
        tag="Status Page Configuration"
        title={statusPage.name}
        subtitle={
          statusPage.customDomain || statusPage.subdomain
            ? `${statusPage.customDomain || `${statusPage.subdomain}.opsknight.com`} · ${publicHref}`
            : `Independent public status page surface · ${publicHref}`
        }
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <Globe className="h-8 w-8" />
          </div>
        }
        badges={
          <>
            {statusPage.isDefault && (
              <Badge
                variant="outline"
                className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
              >
                Default Routing
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                'text-xs font-semibold',
                statusPage.enabled
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full inline-block mr-1.5',
                  statusPage.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-400'
                )}
              />
              {statusPage.enabled ? 'Enabled' : 'Draft / Disabled'}
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs font-medium"
            >
              {statusPage.requireAuth ? 'Restricted (Auth Required)' : 'Public Access'}
            </Badge>
          </>
        }
        actions={
          statusPage.enabled && !statusPage.requireAuth ? (
            <Link
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white text-zinc-900 hover:bg-white/90 transition-colors shadow-xs"
            >
              <span>Open live page</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : undefined
        }
        stats={[
          {
            label: 'Mapped Services',
            value: `${visibleServicesCount}`,
            icon: <Layers className="h-3.5 w-3.5" />,
            subtext: `${statusPage.services.length} total assigned`,
          },
          {
            label: 'Subscribers',
            value: `${subscriberCount}`,
            icon: <Users className="h-3.5 w-3.5" />,
            subtext: 'Active verified',
          },
          {
            label: 'Announcements',
            value: `${statusPage.announcements.length}`,
            icon: <Megaphone className="h-3.5 w-3.5" />,
            subtext: 'Published notices',
          },
          {
            label: 'API Tokens',
            value: `${statusPage.apiTokens.length}`,
            icon: <Key className="h-3.5 w-3.5" />,
            subtext: 'Configured credentials',
          },
        ]}
      />
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <StatusPageConfig
          key={statusPage.id}
          statusPage={formattedStatusPage}
          allServices={allServices}
          liveSnapshot={liveSnapshot}
        />
      </div>
    </div>
  );
}
