import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { cn } from '@/lib/utils';
import NotificationHistory from '@/components/settings/NotificationHistory';
import { History, BellRing, Activity } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { requirePageAccess } from '@/lib/access/server';

export default async function NotificationHistoryPage() {
  await requirePageAccess('/settings/notifications/history');
  const permissions = await getUserPermissions();

  if (!permissions) {
    redirect('/login');
  }

  const canManageProviders = permissions.isAdmin;
  const canViewOperations = permissions.isAdmin || permissions.isAuditor;

  return (
    <div className="space-y-6">
      {/* 1. Shaded Top Hero Banner */}
      <SettingsPageHeader
        title="Delivery History & Logs"
        description="Personal audit trail of outbound alerts, emails, and push notifications sent to you — not workspace-wide. Scoped to your account only."
        icon={History}
        primaryAction={
          canManageProviders || canViewOperations ? (
            <div className="flex items-center gap-2">
              {canManageProviders && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className={cn('gap-2', pageHeaderActionClass)}
                >
                  <Link href="/settings/notifications">
                    <BellRing className="h-4 w-4" aria-hidden="true" />
                    Configure Providers
                  </Link>
                </Button>
              )}
              {canViewOperations && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className={cn('gap-2', pageHeaderActionClass)}
                >
                  <Link href="/settings/notifications/operations">
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    Delivery Operations
                  </Link>
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* 2. Notification History Data Component */}
      <NotificationHistory />
    </div>
  );
}
