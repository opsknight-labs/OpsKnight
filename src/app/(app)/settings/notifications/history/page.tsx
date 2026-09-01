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

  return (
    <div className="space-y-6">
      {/* 1. Shaded Top Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Notification Providers',
          href: '/settings/notifications',
          current: 'History',
        }}
        tag="Outbound Audit Trail"
        title="Delivery History & Logs"
        subtitle="Comprehensive audit trail of all outbound paging alerts, transactional emails, push notifications, and messaging dispatches."
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
          <div className="flex items-center gap-2">
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
          </div>
        }
      />

      {/* 2. Notification History Data Component */}
      <NotificationHistory />
    </div>
  );
}
