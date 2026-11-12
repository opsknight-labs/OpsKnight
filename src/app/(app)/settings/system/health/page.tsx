import { assertAdmin } from '@/lib/rbac';
import { collectAdminHealth } from '@/lib/admin-health';
import SystemHealthCenter from '@/components/settings/SystemHealthCenter';
import IngestionHealthPanel from '@/components/settings/IngestionHealthPanel';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminHealthCenterPage() {
  await requirePageAccess('/settings/system/health');
  await assertAdmin();
  const report = await collectAdminHealth();

  return (
    <div className="space-y-6 pb-12">
      <SystemHealthCenter initialReport={report} />
      <IngestionHealthPanel />
    </div>
  );
}
