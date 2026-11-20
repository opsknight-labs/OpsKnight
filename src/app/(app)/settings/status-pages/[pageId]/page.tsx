import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { IntegrationStatusBadge } from '@/components/settings/integrations/IntegrationStatus';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import { Globe, Layers, Users, Megaphone, Key, ExternalLink } from 'lucide-react';
import StatusPageWorkspace from '@/components/status-page/StatusPageWorkspace';
import { getStatusPageSnapshot, buildStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import type { StatusAnnouncementType } from '@/lib/validation';
import { requirePageAccess } from '@/lib/access/server';

function normalizeAnnouncementType(value: string): StatusAnnouncementType {
  switch (value) {
    case 'INCIDENT':
    case 'MAINTENANCE':
    case 'UPDATE':
    case 'WARNING':
    case 'INFO':
      return value;
    default:
      return 'INFO';
  }
}

export default async function StatusPageWorkspacePage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  await requirePageAccess('/settings/status-pages/[pageId]');
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
    announcements: (statusPage.announcements ?? []).map(announcement => ({
      ...announcement,
      type: normalizeAnnouncementType(announcement.type),
      startDate: announcement.startDate.toISOString(),
      endDate: announcement.endDate?.toISOString() || null,
      publishAt: announcement.publishAt?.toISOString() || null,
      createdAt: announcement.createdAt?.toISOString() || null,
      updatedAt: announcement.updatedAt?.toISOString() || null,
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
    <div className="space-y-6">
      <SettingsPageHeader
        title={statusPage.name}
        trail={[{ label: statusPage.name }]}
        description={
          statusPage.customDomain || statusPage.subdomain
            ? `${statusPage.customDomain || `${statusPage.subdomain}.opsknight.com`} · ${publicHref}`
            : `Public URL ${publicHref}`
        }
        icon={Globe}
        badges={
          <>
            <IntegrationStatusBadge
              onDark
              state={statusPage.enabled ? 'connected' : 'not_connected'}
              label={statusPage.enabled ? 'Published' : 'Draft'}
            />
            {statusPage.isDefault && <span className={pageHeaderBadgeClass}>Default page</span>}
            <span className={pageHeaderBadgeClass}>
              {statusPage.requireAuth ? 'Sign-in required' : 'Public'}
            </span>
          </>
        }
        primaryAction={
          statusPage.enabled && !statusPage.requireAuth ? (
            <Button asChild size="sm" className="gap-2">
              <a href={publicHref} target="_blank" rel="noopener noreferrer">
                Open live page
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
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
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <StatusPageWorkspace
          key={statusPage.id}
          statusPage={formattedStatusPage}
          allServices={allServices}
          liveSnapshot={liveSnapshot}
        />
      </div>
    </div>
  );
}
