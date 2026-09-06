import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import NotificationHistory from '@/components/settings/NotificationHistory';
import { History, BellRing, Activity } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';

export default async function NotificationHistoryPage() {
  const permissions = await getUserPermissions();

  if (!permissions) {
    redirect('/login');
  }

  const canManageProviders = permissions.isAdmin;
  const canViewOperations = permissions.isAdmin || permissions.isAuditor;

  return (
    <div className="space-y-6">
      {/* 1. Shaded Top Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: canManageProviders ? 'Notification Providers' : 'Settings',
          href: canManageProviders ? '/settings/notifications' : '/settings',
          current: 'History',
        }}
        tag="Your Account Activity"
        title="Delivery History & Logs"
        subtitle="Personal audit trail of outbound alerts, emails, and push notifications sent to you — not workspace-wide. Scoped to your account only."
        icon={
          <div className="p-3 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 shadow-inner">
            <History className="h-7 w-7" />
          </div>
        }
        badges={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Audit Stream
            </Badge>
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold"
            >
              Live Telemetry
            </Badge>
          </div>
        }
        actions={
          canManageProviders || canViewOperations ? (
            <div className="flex items-center gap-2">
              {canManageProviders && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
                >
                  <Link href="/settings/notifications">
                    <BellRing className="h-3.5 w-3.5" />
                    Configure Providers
                  </Link>
                </Button>
              )}
              {canViewOperations && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
                >
                  <Link href="/settings/notifications/operations">
                    <Activity className="h-3.5 w-3.5" />
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
