import { Breadcrumbs, PageHeader } from '@/components/patterns';
import SectionHeader from '@/components/analytics/SectionHeader';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Plus,
  LayoutDashboard,
  Sparkles,
  Terminal,
  Shield,
  Users,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import { DASHBOARD_TEMPLATES } from '@/lib/reports/dashboard-templates';
import CreateBlankDashboardButton from './CreateBlankDashboardButton';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create Dashboard | OpsKnight',
  description: 'Create a new custom dashboard',
};

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'executive-summary': LayoutDashboard,
  'sre-operations': Terminal,
  'sla-performance': Shield,
  'team-performance': Users,
  minimal: Minus,
};

export default async function NewDashboardPage() {
  await requirePageAccess('/reports/executive/new');
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/reports/executive/new');
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            className="lg:hidden"
            items={[
              { label: 'Reports & Dashboards', href: '/reports' },
              { label: 'New dashboard' },
            ]}
          />
        }
        title="New dashboard"
        icon={LayoutDashboard}
        description="Start from a template or build one from scratch."
      />

      <section aria-labelledby="new-dashboard-blank" className="space-y-4">
        <SectionHeader id="new-dashboard-blank" icon={<Plus />} title="Start from scratch" />
        <Card className="max-w-md border-dashed">
          <CardHeader>
            <div
              aria-hidden="true"
              className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-muted"
            >
              <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">Blank dashboard</CardTitle>
            <CardDescription>Create an empty dashboard and add widgets yourself.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBlankDashboardButton />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="new-dashboard-templates" className="space-y-4">
        <SectionHeader
          id="new-dashboard-templates"
          icon={<Sparkles />}
          title="Start from a template"
          description="Open a template to preview it with live data, then clone it."
        />
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {DASHBOARD_TEMPLATES.map(template => {
            const Icon = TEMPLATE_ICONS[template.id] || LayoutDashboard;
            return (
              <li key={template.id}>
                <Link
                  href={`/reports/executive?template=${template.id}`}
                  className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Card className="h-full transition-[border-color,box-shadow] duration-150 group-hover:border-ink-300 group-hover:shadow-md">
                    <CardHeader>
                      <div
                        aria-hidden="true"
                        className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-base group-hover:underline">
                        {template.name}
                      </CardTitle>
                      <CardDescription className="text-xs">{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {template.widgets.length} widgets · Preview and clone
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
