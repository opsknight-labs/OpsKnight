import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { getUserPermissions } from '@/lib/rbac';
import { listPrivacyRequests } from '@/lib/privacy/requests';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import PrivacyRequestsBoard from '@/components/settings/privacy/PrivacyRequestsBoard';
import { requirePageAccess } from '@/lib/access/server';

export default async function PrivacyRequestsPage() {
  await requirePageAccess('/settings/privacy-requests');
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(CAPABILITIES.PRIVACY_READ)) {
    redirect('/settings');
  }
  const canManage = permissions.capabilities.includes(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);
  const canExport = permissions.capabilities.includes(CAPABILITIES.PRIVACY_EXPORT);
  const canErase = permissions.capabilities.includes(CAPABILITIES.PRIVACY_ERASURE);

  const [{ requests, nextCursor }, operatorCandidates, subjectUsers, requestCounts] =
    await Promise.all([
      listPrivacyRequests(),
      prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'AUDITOR'] }, status: 'ACTIVE' },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
        take: 25,
      }),
      Promise.all([
        prisma.privacyRequest.count(),
        prisma.privacyRequest.count({
          where: { status: { notIn: ['COMPLETED', 'REJECTED'] } },
        }),
        prisma.privacyRequest.count({ where: { status: 'COMPLETED' } }),
      ]),
    ]);
  // Assignment is restricted server-side too; only show eligible operators here.
  const assignableUsers = operatorCandidates.filter(user =>
    hasCapability(user.role as AppRole, CAPABILITIES.PRIVACY_REQUESTS_MANAGE)
  );

  return (
    <div className="space-y-6 pb-12">
      <SettingsPageHeader
        title="Privacy Requests"
        description="Receive, verify, and fulfil data subject requests. Access, Portability, and Erasure are automated in this release; other request types require manual review."
        icon={ShieldCheck}
        stats={[
          { label: 'Total requests', value: String(requestCounts[0]) },
          {
            label: 'Open',
            value: String(requestCounts[1]),
          },
          {
            label: 'Completed',
            value: String(requestCounts[2]),
          },
        ]}
      />

      <PrivacyRequestsBoard
        initialRequests={requests}
        initialNextCursor={nextCursor}
        assignableUsers={assignableUsers}
        subjectUsers={subjectUsers}
        canManage={canManage}
        canExport={canExport}
        canErase={canErase}
      />
    </div>
  );
}
