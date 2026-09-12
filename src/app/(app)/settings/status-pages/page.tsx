import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { StatusPageManager } from '@/components/status-page/StatusPageManager';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Globe,
  ShieldCheck,
  Layers,
  Users,
  ExternalLink,
  ArrowRight,
  Shield,
  Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default async function StatusPagesControlCenter() {
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
      {/* Centralized Glassmorphic Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Status Pages',
        }}
        tag="Public Communication & Status Infrastructure"
        title="Status Pages"
        subtitle="Manage independent public communication surfaces. Configure branding, mapped services, custom domains, and subscriber notifications."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <Globe className="h-8 w-8" />
          </div>
        }
        actions={<StatusPageManager />}
        badges={
          <>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
            >
              Independent Domains
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs"
            >
              {enabledCount} Active · {totalPages} Configured
            </Badge>
          </>
        }
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
        <Card className="border-dashed border-border bg-card p-12 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
            <Globe className="h-6 w-6" />
          </div>
          <h2 className="text-base font-bold text-foreground">No public status pages yet</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Create your first draft page, map affected services, configure custom domains, and
            publish when ready.
          </p>
          <div className="mt-5 flex justify-center">
            <StatusPageManager />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pages.map(page => {
            const publicHref = getStatusPagePublicUrl(page);
            const domainDisplay =
              page.customDomain ||
              (page.subdomain ? `${page.subdomain}.opsknight.com` : publicHref);

            return (
              <Card
                key={page.id}
                className="group relative border-border bg-card hover:border-primary/40 hover:shadow-xs transition-all duration-150 rounded-xl overflow-hidden flex flex-col justify-between"
              >
                <div className="p-5 space-y-4">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 ring-1 ring-primary/15">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <h2 className="text-base font-bold text-foreground truncate group-hover:text-primary transition-colors">
                          {page.name}
                        </h2>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {domainDisplay}
                        </p>
                      </div>
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {page.isDefault && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-semibold px-2 py-0.5 border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                        >
                          Default
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-medium px-2 py-0.5 h-5 flex items-center gap-1.5 rounded-full border',
                          page.enabled
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-border/60 bg-muted/40 text-muted-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full shrink-0',
                            page.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50'
                          )}
                        />
                        <span>{page.enabled ? 'Enabled' : 'Disabled'}</span>
                      </Badge>
                    </div>
                  </div>

                  {/* Metadata Chips */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border/50">
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      <span>
                        <strong className="font-semibold text-foreground">
                          {page._count.services}
                        </strong>{' '}
                        services
                      </span>
                    </div>

                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border/50">
                      <Users className="h-3 w-3 text-muted-foreground" />
                      <span>
                        <strong className="font-semibold text-foreground">
                          {page._count.subscriptions}
                        </strong>{' '}
                        subscribers
                      </span>
                    </div>

                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border/50">
                      <Shield className="h-3 w-3 text-muted-foreground" />
                      <span className="capitalize">
                        {page.privacyMode?.toLowerCase() || 'public'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="px-5 py-3 bg-muted/15 border-t border-border/50 flex items-center justify-between gap-3">
                  {page.enabled ? (
                    <Link
                      href={publicHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Open public page</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground/60 italic flex items-center gap-1">
                      <Radio className="h-3 w-3" /> Page is offline
                    </span>
                  )}

                  <Link href={`/settings/status-pages/${encodeURIComponent(page.id)}`}>
                    <Button size="sm" className="h-8 gap-1.5 text-xs font-semibold shadow-xs">
                      <span>Manage</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
