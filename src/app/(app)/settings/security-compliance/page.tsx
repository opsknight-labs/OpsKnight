import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { complianceControls } from '@/lib/compliance/controls';
import { frameworks } from '@/lib/compliance/frameworks';
import { getReadiness } from '@/lib/compliance/readiness';
import { discoverSubjectData, subjectDiscoveryInputSchema } from '@/lib/privacy/discovery';
import { personalDataRegistry } from '@/lib/privacy/registry';
import { getUserPermissions } from '@/lib/rbac';
import ComplianceClientTabs from '@/components/settings/compliance/ComplianceClientTabs';
import type { Prisma } from '@prisma/client';

const USER_SEARCH_PAGE_SIZE = 30;

export default async function SecurityCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; q?: string; page?: string; tab?: string }>;
}) {
  // Read-only readiness diagnostics — not certification or legal conclusions
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE)) redirect('/settings');

  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? '';
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // DB Performance Optimization: Only query user database if the user is interacting with Privacy & DSR discovery
  const shouldQueryPrivacyUsers = Boolean(query || params.userId || params.tab === 'privacy');

  const userWhere = (
    query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}
  ) satisfies Prisma.UserWhereInput;

  const parsedSubject = subjectDiscoveryInputSchema.safeParse({
    userId: params.userId,
    actorUserId: permissions.id,
  });

  const [users, userCount, selectedUser, discovery] = shouldQueryPrivacyUsers
    ? await Promise.all([
        prisma.user.findMany({
          where: userWhere,
          select: { id: true, name: true, email: true, status: true },
          orderBy: [{ name: 'asc' }, { email: 'asc' }],
          skip: (page - 1) * USER_SEARCH_PAGE_SIZE,
          take: USER_SEARCH_PAGE_SIZE,
        }),
        prisma.user.count({ where: userWhere }),
        parsedSubject.success
          ? prisma.user.findUnique({
              where: { id: parsedSubject.data.userId },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve(null),
        parsedSubject.success ? discoverSubjectData(parsedSubject.data) : Promise.resolve(null),
      ])
    : [[], 0, null, null];

  const pageCount = Math.max(1, Math.ceil(userCount / USER_SEARCH_PAGE_SIZE));
  const overall = getReadiness();

  const frameworkList = frameworks.map(fw => ({
    id: fw.id,
    title: fw.title,
    scope: fw.scope,
    source: fw.source,
    counts: getReadiness(fw.id),
  }));

  return (
    <div className="space-y-6 pb-12 w-full">
      <ComplianceClientTabs
        overall={overall}
        frameworks={frameworkList}
        controls={complianceControls}
        personalDataRegistry={personalDataRegistry}
        privacyData={{
          users,
          userCount,
          selectedUser,
          discovery,
          query,
          page,
          pageCount,
          userId: params.userId,
        }}
      />
    </div>
  );
}
