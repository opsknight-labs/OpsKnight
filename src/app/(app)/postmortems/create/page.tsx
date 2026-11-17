import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PostmortemForm from '@/components/PostmortemForm';
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

export default async function CreatePostmortemPage() {
  await requirePageAccess('/postmortems/create');
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);
  const canCreate = permissions.isResponderOrAbove;

  if (!canCreate) {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
        <PageHeader
          breadcrumbs={
            <Breadcrumbs
              className="lg:hidden"
              items={[{ label: 'Postmortems', href: '/postmortems' }, { label: 'New postmortem' }]}
            />
          }
          title="New postmortem"
          icon={FileText}
          description="Pick a resolved incident, then record what happened, why, and what changes next."
        />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>You don&apos;t have permission to create postmortems.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const resolvedIncidentRows = await prisma.incident.findMany({
    where: {
      AND: [incidentReadWhere(actor), { status: 'RESOLVED', postmortem: null }],
    },
    include: {
      service: {
        select: {
          name: true,
        },
      },
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
    orderBy: { resolvedAt: 'desc' },
    take: 100,
  });

  const resolvedIncidents = resolvedIncidentRows.map(incident => ({
    id: incident.id,
    title: incident.title,
    resolvedAt: incident.resolvedAt,
    service: incident.service,
    jiraIssues: incident.externalIssueLinks.map(serializeJiraIssueReference),
  }));

  const users = await prisma.user.findMany({
    where: { AND: [{ status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });

  // No incident has been selected/persisted yet, so action-item Jira mutations
  // deliberately stay non-operational. Incident Jira references are still
  // inherited read-only as soon as the user selects an incident above.
  const jiraCapability = await getJiraCapabilities({
    serviceId: null,
    canManage: canCreate,
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            className="lg:hidden"
            items={[{ label: 'Postmortems', href: '/postmortems' }, { label: 'New postmortem' }]}
          />
        }
        title="New postmortem"
        icon={FileText}
        description="Pick a resolved incident, then record what happened, why, and what changes next."
      />

      {resolvedIncidents.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<FileText />}
          title="No resolved incidents need a postmortem"
          description="Every resolved incident you can see already has a postmortem. Postmortems start from a resolved incident."
          primaryAction={
            <Button asChild size="sm">
              <Link href="/incidents">View incidents</Link>
            </Button>
          }
        />
      ) : (
        <PostmortemForm
          incidentId=""
          users={users}
          resolvedIncidents={resolvedIncidents}
          jiraCapability={jiraCapability}
        />
      )}
    </div>
  );
}
