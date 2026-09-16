import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { getUserPermissions } from '@/lib/rbac';
import { listPrivacyRequests } from '@/lib/privacy/requests';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import PrivacyRequestsBoard from '@/components/settings/privacy/PrivacyRequestsBoard';

export default async function PrivacyRequestsPage() {
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(CAPABILITIES.PRIVACY_READ)) {
    redirect('/settings');
  }
  const canManage = permissions.capabilities.includes(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);

  const [requests, assignableUsers] = await Promise.all([
    listPrivacyRequests(),
    prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'AUDITOR'] }, status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6 pb-12">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Privacy Requests' }}
        tag="Data subject access requests"
        title="Privacy Requests"
        subtitle="Receive, verify, and fulfil data subject requests. Only Access and Portability are automated in this release; other request types require manual review."
        icon={
          <div className="rounded-2xl border border-primary-foreground/25 bg-primary-foreground/15 p-3.5 text-primary-foreground">
            <ShieldCheck className="h-8 w-8" />
          </div>
        }
        stats={[
          { label: 'Total requests', value: String(requests.length) },
          {
            label: 'Open',
            value: String(
              requests.filter(r => r.status !== 'COMPLETED' && r.status !== 'REJECTED').length
            ),
          },
          {
            label: 'Completed',
            value: String(requests.filter(r => r.status === 'COMPLETED').length),
          },
        ]}
      />

      <PrivacyRequestsBoard
        initialRequests={requests}
        assignableUsers={assignableUsers}
        canManage={canManage}
      />
    </div>
  );
}
