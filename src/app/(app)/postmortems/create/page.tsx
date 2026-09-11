import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PostmortemForm from '@/components/PostmortemForm';
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

export default async function CreatePostmortemPage() {
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
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
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
        <p className="text-muted-foreground">
          Select a resolved incident and document the postmortem
        </p>
      </div>

      {resolvedIncidents.length === 0 ? (
        <Card className="bg-gradient-to-br from-white to-slate-50 border-slate-200 shadow-md">
          <CardContent className="py-8 text-center">
            <h3 className="text-lg font-semibold mb-2">No Resolved Incidents Available</h3>
            <p className="text-muted-foreground mb-4">
              There are no resolved incidents without postmortems. Resolve an incident first to
              create a postmortem.
            </p>
            <Link href="/incidents">
              <Button>View Incidents</Button>
            </Link>
          </CardContent>
        </Card>
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
