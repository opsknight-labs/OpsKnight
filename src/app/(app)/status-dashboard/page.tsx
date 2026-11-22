import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import StatusBoardPage from './board-page';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Internal status dashboard: every business service the viewer can see, worst first. */
export default async function StatusDashboardPage() {
  await requirePageAccess('/status-dashboard');
  const actor = await getCurrentAuthorizationActor();
  return <StatusBoardPage actor={actor} dashboard={null} />;
}
