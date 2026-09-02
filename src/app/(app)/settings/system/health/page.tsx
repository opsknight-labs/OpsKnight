import { assertAdmin } from '@/lib/rbac';
import { collectAdminHealth } from '@/lib/admin-health';
import SystemHealthCenter from '@/components/settings/SystemHealthCenter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminHealthCenterPage() {
  await assertAdmin();
  const report = await collectAdminHealth();

  return (
    <div className="space-y-6 pb-12">
      <SystemHealthCenter initialReport={report} />
    </div>
  );
}
