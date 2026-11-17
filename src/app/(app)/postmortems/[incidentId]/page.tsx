import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { notFound, redirect } from 'next/navigation';
import { getPostmortem } from '../actions';
import PostmortemForm from '@/components/PostmortemForm';
import PostmortemDetailView from '@/components/postmortem/PostmortemDetailView';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { dashboardUserReadWhere, incidentReadWhere } from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { AlertTriangle, FileText } from 'lucide-react';
import { Breadcrumbs, EmptyState, PageHeader } from '@/components/patterns';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';
import { requirePageAccess } from '@/lib/access/server';

export default async function PostmortemPage({
  params,
  searchParams,
}: {
  params: Promise<{ incidentId: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
  await requirePageAccess('/postmortems/[incidentId]');
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  const { incidentId } = await params;
  const searchParamsData = await searchParams;
  const editMode = searchParamsData?.edit === 'true';

  const postmortem = await getPostmortem(incidentId);
  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);
  const canEdit = permissions.isResponderOrAbove;
  const canView = postmortem ? postmortem.status === 'PUBLISHED' || canEdit : canEdit;

  // Resolve the incident once through the authorization boundary. Jira links
  // owned by the incident are inherited as read-only context by the postmortem
  // and its action items; they are not duplicated into ActionItem link rows.
  const incidentContext = await prisma.incident.findFirst({
    where: { AND: [incidentReadWhere(actor), { id: incidentId }] },
    select: {
      id: true,
      title: true,
      status: true,
      serviceId: true,
      externalIssueLinks: {
        where: { provider: 'JIRA' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provider: true,
          externalKey: true,
          externalUrl: true,
          externalStatus: true,
          externalAssignee: true,
          syncState: true,
        },
      },
    },
  });

  if (!incidentContext) notFound();

  const incidentJiraIssues = incidentContext.externalIssueLinks.map(serializeJiraIssueReference);
  const jiraCapability = await getJiraCapabilities({
    serviceId: incidentContext.serviceId,
    canManage: canEdit,
  });

  const users = await prisma.user.findMany({
    where: { AND: [{ status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });

  const container = 'mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8';
  const incidentLink = (
    <Link
      href={`/incidents/${incidentId}`}
      className="rounded-sm font-medium text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
    >
      {incidentContext.title}
    </Link>
  );

  if (!postmortem) {
    const header = (
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            className="lg:hidden"
            items={[{ label: 'Postmortems', href: '/postmortems' }, { label: 'New postmortem' }]}
          />
        }
        title="New postmortem"
        icon={FileText}
        description={<>For incident {incidentLink}</>}
      />
    );

    if (incidentContext.status !== 'RESOLVED') {
      return (
        <div className={container}>
          {header}
          <EmptyState
            variant="card"
            icon={<FileText />}
            title="This incident is not resolved yet"
            description="Postmortems are written once an incident is resolved, so the timeline and impact are complete. Resolve the incident first, then come back here."
            primaryAction={
              <Button asChild size="sm">
                <Link href={`/incidents/${incidentId}`}>Open incident</Link>
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className={container}>
        {header}
        {canEdit ? (
          <PostmortemForm
            incidentId={incidentId}
            users={users}
            jiraCapability={jiraCapability}
            incidentJiraIssues={incidentJiraIssues}
          />
        ) : (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              You don&apos;t have permission to create postmortems.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className={container}>
      {canView ? (
        editMode && canEdit ? (
          <>
            <PageHeader
              breadcrumbs={
                <Breadcrumbs
                  className="lg:hidden"
                  items={[
                    { label: 'Postmortems', href: '/postmortems' },
                    { label: postmortem.title, href: `/postmortems/${incidentId}` },
                    { label: 'Edit' },
                  ]}
                />
              }
              title={`Edit: ${postmortem.title}`}
              icon={FileText}
              description={<>Postmortem for {incidentLink}</>}
            />
            <PostmortemForm
              incidentId={incidentId}
              initialData={postmortem}
              users={users}
              jiraCapability={jiraCapability}
              incidentJiraIssues={incidentJiraIssues}
            />
          </>
        ) : (
          <PostmortemDetailView
            postmortem={postmortem}
            users={users}
            canEdit={canEdit}
            incidentId={incidentId}
            jiraCapability={jiraCapability}
            incidentJiraIssues={incidentJiraIssues}
          />
        )
      ) : (
        <>
          <PageHeader
            breadcrumbs={
              <Breadcrumbs
                className="lg:hidden"
                items={[
                  { label: 'Postmortems', href: '/postmortems' },
                  { label: postmortem.title },
                ]}
              />
            }
            title={postmortem.title}
            icon={FileText}
            description={<>Postmortem for {incidentLink}</>}
          />
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              You don&apos;t have permission to view this postmortem. Only published postmortems are
              visible to everyone.
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}
