import { assertAdmin } from '@/lib/rbac';
import { collectAdminHealth } from '@/lib/admin-health';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import SystemHealthCenter from '@/components/settings/SystemHealthCenter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminHealthCenterPage() {
  await assertAdmin();
  const report = await collectAdminHealth();

  return (
    <div className="space-y-6 pb-12">
      <SettingsPageHeader
        title="System Health & Diagnostics Center"
        description="Comprehensive operational diagnostic signals across PostgreSQL, background job workers, Redis queue, and integrations."
        backHref="/settings"
        backLabel="Back to Settings"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'System', href: '/settings/system' },
          { label: 'Health & Diagnostics', href: '/settings/system/health' },
        ]}
      />

      <SystemHealthCenter initialReport={report} />
    </div>
  );
}
