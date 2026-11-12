import { Inbox } from 'lucide-react';

import { requirePageAccessSnapshot } from '@/lib/access/server';
import { describeAccessRequest, listDecidableAccessRequests } from '@/lib/access/requests';
import { roleLabel, type AppRole } from '@/lib/authorization';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { DecideRequestControls } from '@/components/access/AccessControls';

export const dynamic = 'force-dynamic';

export default async function AccessRequestsPage() {
  const access = await requirePageAccessSnapshot('/settings/access/requests');
  const isOrgAdmin = access.capabilities.includes('admin.manage');
  const requests = await listDecidableAccessRequests({ id: access.userId, isOrgAdmin });
  const managesTeams = access.teams.some(team => team.role === 'OWNER' || team.role === 'ADMIN');

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        tag="Access"
        title="Access requests"
        subtitle={
          isOrgAdmin
            ? 'Review role and team requests from across your organization.'
            : 'Review requests to join the teams you own or administer.'
        }
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <Inbox className="h-8 w-8" />
          </div>
        }
      />
      <SettingsSection
        title={`Waiting for a decision (${requests.length})`}
        description="Approving can grant access permanently or for a limited time. Every decision is recorded in the audit log, and you cannot approve your own request."
      >
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isOrgAdmin || managesTeams
              ? 'Nothing to review right now.'
              : 'You can review requests for teams you own or administer. You don’t manage any team yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {requests.map(request => (
              <li key={request.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <strong>{request.requester.name ?? request.requester.email}</strong>
                  <span className="text-muted-foreground">
                    ({roleLabel(request.requester.role as AppRole)}) asked for
                  </span>
                  <strong>{describeAccessRequest(request)}</strong>
                </div>
                <p className="rounded-md bg-muted/40 p-2 text-sm">“{request.reason}”</p>
                <p className="text-xs text-muted-foreground">
                  Requested {request.createdAt.toLocaleString()}
                  {request.originPath ? ` while opening ${request.originPath}` : ''}
                </p>
                <DecideRequestControls
                  requestId={request.id}
                  requestedDuration={request.durationMinutes}
                  isOwnRequest={request.requesterId === access.userId}
                />
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
