import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getPostmortem } from '../actions';
import { notFound } from 'next/navigation';
import PostmortemForm from '@/components/PostmortemForm';
import PostmortemDetailView from '@/components/postmortem/PostmortemDetailView';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import { dashboardUserReadWhere, incidentReadWhere } from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';

export default async function PostmortemPage({
  params,
  searchParams,
}: {
  params: Promise<{ incidentId: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
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

  if (!postmortem) {
    if (incidentContext.status !== 'RESOLVED') {
      return (
        <div className="p-6">
          <Card className="text-center">
            <CardContent className="py-8">
              <h2 className="text-xl font-semibold mb-2">Incident Not Resolved</h2>
              <p className="text-muted-foreground mb-4">
                Postmortems can only be created for resolved incidents.
              </p>
              <Link href={`/incidents/${incidentId}`}>
                <Button>View Incident</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="p-6">
        <div className="mb-6">
          <Link
            href="/postmortems"
            className="text-muted-foreground no-underline text-sm mb-2 inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Postmortems
          </Link>
          <h1 className="text-2xl font-bold mt-2">Create Postmortem</h1>
          <p className="text-muted-foreground">For incident: {incidentContext.title}</p>
        </div>

        {canEdit ? (
          <PostmortemForm
            incidentId={incidentId}
            users={users}
            jiraCapability={jiraCapability}
            incidentJiraIssues={incidentJiraIssues}
          />
        ) : (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You don&apos;t have permission to create postmortems.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/postmortems"
          className="text-muted-foreground no-underline text-sm mb-2 inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Postmortems
        </Link>
        <h1 className="text-2xl font-bold mt-2">{postmortem.title}</h1>
        <p className="text-muted-foreground">
          Postmortem for{' '}
          <Link
            href={`/incidents/${incidentId}`}
            className="text-primary no-underline hover:underline"
          >
            {postmortem.incident.title}
          </Link>
        </p>
      </div>

      {canView ? (
        editMode && canEdit ? (
          <PostmortemForm
            incidentId={incidentId}
            initialData={postmortem}
            users={users}
            jiraCapability={jiraCapability}
            incidentJiraIssues={incidentJiraIssues}
          />
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
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            You don&apos;t have permission to view this postmortem. Only published postmortems are
            publicly viewable.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
