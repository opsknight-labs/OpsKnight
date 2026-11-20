import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { IntegrationStatusBadge } from '@/components/settings/integrations/IntegrationStatus';
import { EmptyState, toneClasses } from '@/components/patterns';
import { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import { StatusPageManager } from '@/components/status-page/StatusPageManager';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { Button } from '@/components/ui/shadcn/button';
import { Globe, ShieldCheck, Layers, Users, ExternalLink, ArrowRight, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requirePageAccess } from '@/lib/access/server';

export default async function StatusPagesControlCenter() {
  await requirePageAccess('/settings/status-pages');
  const session = await getServerSession(await getAuthOptions());
  if (!session) redirect('/login');
  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }

  const pages = await prisma.statusPage.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      isDefault: true,
      privacyMode: true,
      customDomain: true,
      subdomain: true,
      updatedAt: true,
      _count: {
        select: {
          services: { where: { showOnPage: true } },
          subscriptions: { where: { verified: true, unsubscribedAt: null } },
        },
      },
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  const totalPages = pages.length;
  const enabledCount = pages.filter(p => p.enabled).length;
  const totalServices = pages.reduce((acc, p) => acc + p._count.services, 0);
  const totalSubscribers = pages.reduce((acc, p) => acc + p._count.subscriptions, 0);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Status Pages"
        description="Public pages that tell customers what is affected. Configure branding, mapped services, custom domains and subscriber notifications."
        icon={Globe}
        primaryAction={<StatusPageManager canCreate={totalPages < 1} />}
        stats={[
          {
            label: 'Total Pages',
            value: `${totalPages}`,
            icon: <Globe className="h-3.5 w-3.5" />,
            subtext: 'Configured surfaces',
          },
          {
            label: 'Active Pages',
            value: `${enabledCount}`,
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext: 'Live public pages',
          },
          {
            label: 'Mapped Services',
            value: `${totalServices}`,
            icon: <Layers className="h-3.5 w-3.5" />,
            subtext: 'Across all pages',
          },
          {
            label: 'Subscribers',
            value: `${totalSubscribers}`,
            icon: <Users className="h-3.5 w-3.5" />,
            subtext: 'Active email/webhooks',
          },
        ]}
      />

      {pages.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Globe />}
          title="No status pages yet"
          description="Create a draft page, map the services customers care about, and publish when it's ready."
          action={<StatusPageManager variant="default" canCreate={totalPages < 1} />}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Status pages">
          {pages.map(page => {
            const publicHref = getStatusPagePublicUrl(page);
            const domainDisplay =
              page.customDomain ||
              (page.subdomain ? `${page.subdomain}.opsknight.com` : publicHref);
            const manageHref = `/settings/status-pages/${encodeURIComponent(page.id)}`;

            return (
              <li
                key={page.id}
                className="flex flex-col justify-between overflow-hidden rounded-lg border border-border bg-card shadow-sm"
              >
                <div className="space-y-4 p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                        <Globe className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <h2 className="truncate text-base font-semibold text-foreground">
                          <Link
                            href={manageHref}
                            className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {page.name}
                          </Link>
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {page.isDefault
                            ? 'Default page'
                            : page.slug
                              ? `Route: /${page.slug}`
                              : 'Independent status page'}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {page.isDefault && (
                        <span
                          className={cn(
                            BADGE_BASE_CLASS,
                            badgeSizeClass('sm'),
                            toneClasses(null).soft
                          )}
                        >
                          Default
                        </span>
                      )}
                      <IntegrationStatusBadge
                        state={page.enabled ? 'connected' : 'not_connected'}
                        label={page.enabled ? 'Published' : 'Draft'}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                    <code className="min-w-0 truncate font-mono text-xs text-foreground">
                      {domainDisplay}
                    </code>
                    {page.enabled ? (
                      <a
                        href={publicHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Visit
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        <span className="sr-only">{page.name} (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">Not published</span>
                    )}
                  </div>

                  <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                      <dt className="sr-only">Services</dt>
                      <dd>
                        <span className="font-semibold tabular-nums text-foreground">
                          {page._count.services}
                        </span>{' '}
                        {page._count.services === 1 ? 'service' : 'services'}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      <dt className="sr-only">Subscribers</dt>
                      <dd>
                        <span className="font-semibold tabular-nums text-foreground">
                          {page._count.subscriptions}
                        </span>{' '}
                        {page._count.subscriptions === 1 ? 'subscriber' : 'subscribers'}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                      <dt className="sr-only">Visibility</dt>
                      <dd className="capitalize">{page.privacyMode?.toLowerCase() || 'public'}</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex items-center justify-end border-t border-border bg-muted/30 px-4 py-3 md:px-5">
                  <Button asChild size="sm" className="gap-1.5">
                    <Link href={manageHref} aria-label={`Manage ${page.name}`}>
                      Manage
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
