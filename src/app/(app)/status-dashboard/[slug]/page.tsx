import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getStatusDashboardBySlug } from '@/lib/business-services/dashboards';
import StatusBoardPage from '../board-page';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A custom status dashboard: its business services the viewer can see, worst first. */
export default async function CustomStatusDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requirePageAccess('/status-dashboard/[slug]');
  const [{ slug }, actor] = await Promise.all([params, getCurrentAuthorizationActor()]);
  const dashboard = await getStatusDashboardBySlug(slug.slice(0, 60));
  if (!dashboard) notFound();
  return <StatusBoardPage actor={actor} dashboard={dashboard} />;
}
