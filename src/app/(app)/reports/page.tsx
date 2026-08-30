import prisma from '@/lib/prisma';
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
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import {
  LayoutDashboard,
  Plus,
  Sparkles,
  Terminal,
  Shield,
  Users,
  Minus,
  ArrowRight,
} from 'lucide-react';
import { DASHBOARD_TEMPLATES } from '@/lib/reports/dashboard-templates';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import DashboardCard from '@/components/reports/DashboardCard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reports & Dashboards | OpsKnight',
  description: 'Customizable executive reports and operational dashboards',
};

const TEMPLATE_ICONS: Record<string, any> = {
  'executive-summary': LayoutDashboard,
  'sre-operations': Terminal,
  'sla-performance': Shield,
  'team-performance': Users,
  minimal: Minus,
};

export default async function ReportsPage() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/reports');
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, timeZone: true },
  });

  if (!user) {
    redirect('/login?callbackUrl=/reports');
  }

  const userTimeZone = getUserTimeZone(user);

  // Fetch user's dashboards
  const dashboards = await prisma.dashboard.findMany({
    where: { userId: user.id, isTemplate: false },
    include: { _count: { select: { widgets: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        tag="Operational Analytics"
        title="Reports & Dashboards"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <LayoutDashboard className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Build customizable executive dashboards, track reliability metrics, and visualize
            operational performance widgets.
          </p>
        }
        actions={
          <Button
            asChild
            className="gap-2 shadow-sm font-semibold bg-background text-foreground hover:bg-background/90"
          >
            <Link href="/reports/executive/new">
              <Plus className="h-4 w-4" />
              Create Dashboard
            </Link>
          </Button>
        }
        stats={[
          {
            label: 'Your Dashboards',
            value: dashboards.length,
            icon: <LayoutDashboard className="h-3.5 w-3.5" />,
          },
          {
            label: 'Templates',
            value: DASHBOARD_TEMPLATES.length,
            icon: <Sparkles className="h-3.5 w-3.5 text-amber-200" />,
          },
          {
            label: 'Widget Types',
            value: '30+',
            icon: <Terminal className="h-3.5 w-3.5 text-emerald-200" />,
          },
          {
            label: 'Customizations',
            value: '∞',
            icon: <Shield className="h-3.5 w-3.5 text-blue-200" />,
          },
        ]}
      />

      {/* Templates Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Dashboard Templates</h2>
          </div>
          <span className="text-xs text-muted-foreground">Click to preview or clone</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {DASHBOARD_TEMPLATES.map(template => {
            const Icon = TEMPLATE_ICONS[template.id] || LayoutDashboard;
            return (
              <Link key={template.id} href={`/reports/executive?template=${template.id}`}>
                <Card className="h-full hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group bg-white">
                  <CardHeader className="pb-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center mb-2"
                      style={{ backgroundColor: `${template.color}20` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: template.color }} />
                    </div>
                    <CardTitle className="text-sm font-bold group-hover:text-primary transition-colors">
                      {template.name}
                    </CardTitle>
                    <CardDescription className="text-xs line-clamp-2">
                      {template.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{template.widgets.length} widgets</span>
                      <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* My Dashboards Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">My Dashboards</h2>
          {dashboards.length > 0 && (
            <Link href="/reports/executive/new">
              <Button variant="outline" size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                New Dashboard
              </Button>
            </Link>
          )}
        </div>

        {dashboards.length === 0 ? (
          <EmptyState
            icon={<LayoutDashboard className="h-6 w-6 text-muted-foreground/60" />}
            title="No custom dashboards yet"
            description="Create your first custom operational dashboard or start from an executive template."
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="sm">
                  <Link href="/reports/executive/new">
                    <Plus className="mr-1.5 h-4 w-4" />
                    Create from scratch
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/reports/executive?template=executive-summary`}>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Use template
                  </Link>
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {dashboards.map(dashboard => (
              <DashboardCard
                key={dashboard.id}
                id={dashboard.id}
                name={dashboard.name}
                description={dashboard.description}
                widgetCount={dashboard._count.widgets}
                isDefault={dashboard.isDefault}
                updatedAt={formatDateTime(dashboard.updatedAt, userTimeZone, {
                  format: 'relative',
                })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
