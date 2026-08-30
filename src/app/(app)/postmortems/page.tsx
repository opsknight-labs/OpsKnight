import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getAllPostmortems } from './actions';
import { getUserPermissions } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { FileText, CheckCircle2, Clock, Archive, Plus } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import PostmortemsListTable from '@/components/postmortem/PostmortemsListTable';
import { getUserTimeZone } from '@/lib/timezone';
import { cn } from '@/lib/utils';

export default async function PostmortemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const status = params.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | undefined;
  const page = params.page ? parseInt(params.page) : 1;

  const { postmortems, pagination } = await getAllPostmortems({ status, page });
  const permissions = await getUserPermissions();
  const canCreate = permissions.isResponderOrAbove;

  // Get user timezone for date formatting
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { timeZone: true },
      })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);

  // Get resolved incidents without postmortems for quick create
  const resolvedIncidentsWithoutPostmortems = canCreate
    ? await prisma.incident.findMany({
        where: {
          status: 'RESOLVED',
          postmortem: null,
        },
        select: {
          id: true,
          title: true,
          resolvedAt: true,
        },
        orderBy: { resolvedAt: 'desc' },
        take: 10,
      })
    : [];

  // Fetch counts for metrics
  const [totalCount, publishedCount, draftCount, archivedCount] = await Promise.all([
    prisma.postmortem.count(),
    prisma.postmortem.count({ where: { status: 'PUBLISHED' } }),
    prisma.postmortem.count({ where: { status: 'DRAFT' } }),
    prisma.postmortem.count({ where: { status: 'ARCHIVED' } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        tag="Incident Learning"
        title="Postmortems"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Learn from incidents, document root-cause analyses, track incident timelines, and build
            resilient systems.
          </p>
        }
        statsPlacement="bottom"
        actions={
          canCreate && resolvedIncidentsWithoutPostmortems.length > 0 ? (
            <Button
              asChild
              className="gap-2 shadow-sm font-semibold bg-background text-foreground hover:bg-background/90"
            >
              <Link href="/postmortems/create">
                <Plus className="h-4 w-4" />
                Create Postmortem
                <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                  {resolvedIncidentsWithoutPostmortems.length}
                </span>
              </Link>
            </Button>
          ) : undefined
        }
        stats={[
          {
            label: 'Total',
            value: totalCount,
            icon: <FileText className="h-3.5 w-3.5" />,
            href: '/postmortems',
            active: !status,
          },
          {
            label: 'Published',
            value: publishedCount,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: publishedCount > 0 ? 'text-emerald-200' : undefined,
            href: '/postmortems?status=PUBLISHED',
            active: status === 'PUBLISHED',
          },
          {
            label: 'Drafts',
            value: draftCount,
            icon: <Clock className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: draftCount > 0 ? 'text-amber-200' : undefined,
            href: '/postmortems?status=DRAFT',
            active: status === 'DRAFT',
          },
          {
            label: 'Archived',
            value: archivedCount,
            icon: <Archive className="h-3.5 w-3.5 text-slate-200" />,
            valueClassName: archivedCount > 0 ? 'text-slate-200' : undefined,
            href: '/postmortems?status=ARCHIVED',
            active: status === 'ARCHIVED',
          },
        ]}
      />

      <div className="space-y-4 md:space-y-6">
        {/* Actions & Filters */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <Link
              href="/postmortems"
              className={cn(
                'px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
                !status
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-slate-200/50 hover:text-foreground'
              )}
            >
              All
            </Link>
            <Link
              href="/postmortems?status=PUBLISHED"
              className={cn(
                'px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
                status === 'PUBLISHED'
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-slate-200/50 hover:text-foreground'
              )}
            >
              Published
            </Link>
            <Link
              href="/postmortems?status=DRAFT"
              className={cn(
                'px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
                status === 'DRAFT'
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-slate-200/50 hover:text-foreground'
              )}
            >
              Drafts
            </Link>
          </div>

          {resolvedIncidentsWithoutPostmortems.length > 0 && (
            <Link href="/postmortems/create">
              <Button className="shadow-sm">
                Create Postmortem
                <span className="ml-2 bg-primary-foreground/20 px-1.5 py-0.5 rounded text-xs">
                  {resolvedIncidentsWithoutPostmortems.length}
                </span>
              </Button>
            </Link>
          )}
        </div>

        {/* Postmortems List */}
        {/* Postmortems List */}
        <PostmortemsListTable
          postmortems={postmortems}
          pagination={pagination}
          userTimeZone={userTimeZone}
          canManage={canCreate}
        />
      </div>
    </div>
  );
}
