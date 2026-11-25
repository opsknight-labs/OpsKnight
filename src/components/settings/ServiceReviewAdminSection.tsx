import prisma from '@/lib/prisma';
import { getReviewConfig } from '@/lib/business-services/reviews/config';
import { listReviewRuns } from '@/lib/business-services/reviews/run';
import ServiceReviewAdminPanel from './ServiceReviewAdminPanel';

/** Server wrapper: loads settings, per-team opt-in counts and recent runs for the admin panel. */
export default async function ServiceReviewAdminSection() {
  const [config, runRows, owned] = await Promise.all([
    getReviewConfig(),
    listReviewRuns({ id: '', global: true }, 10),
    prisma.businessService.groupBy({
      by: ['ownerTeamId', 'includeInReview'],
      where: { ownerTeamId: { not: null }, lifecycle: { not: 'RETIRED' } },
      _count: { _all: true },
    }),
  ]);
  const teamIds = [...new Set(owned.map(o => o.ownerTeamId!))];
  const [teams, users] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { id: { in: config.summaryUserIds } },
          { id: { in: runRows.map(r => r.recipientKey) } },
        ],
      },
      select: { id: true, email: true },
    }),
  ]);
  const email = new Map(users.map(u => [u.id, u.email]));
  return (
    <ServiceReviewAdminPanel
      config={{
        ...config,
        summaryEmails: config.summaryUserIds
          .map(id => email.get(id))
          .filter((e): e is string => !!e),
      }}
      teams={teams.map(t => {
        const rows = owned.filter(o => o.ownerTeamId === t.id);
        return {
          ...t,
          total: rows.reduce((n, r) => n + r._count._all, 0),
          included: rows.filter(r => r.includeInReview).reduce((n, r) => n + r._count._all, 0),
        };
      })}
      runs={runRows.map(r => ({
        period: r.period,
        kind: r.kind,
        recipient: email.get(r.recipientKey) ?? r.recipientKey,
        status: r.status,
        serviceCount: r.serviceCount,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}
