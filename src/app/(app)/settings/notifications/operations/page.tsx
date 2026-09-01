import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import NotificationOperations from '@/components/settings/NotificationOperations';
import { getCurrentUser } from '@/lib/rbac';
import { Activity, BellRing, Radio } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';

export default async function NotificationOperationsPage() {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    redirect('/login');
  }

  if (user.role !== 'ADMIN' && user.role !== 'AUDITOR') {
    redirect('/settings');
  }

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        breadcrumb={{
          label: 'Notification Providers',
          href: '/settings/notifications',
          current: 'Operations',
        }}
        tag="Delivery Control Plane"
        title="Notification Operations"
        subtitle="Workspace-wide delivery telemetry, queue health, error diagnostics, and recovery engine for all alert channels."
        icon={<Activity className="h-6 w-6 text-primary" />}
        badges={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-semibold">
              Queue Monitoring
            </Badge>
            <Badge variant="secondary" className="text-xs font-semibold">
              {user.role === 'ADMIN' ? 'Admin Full Control' : 'Auditor Read-Only'}
            </Badge>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 border-border/80 bg-background/80 shadow-xs backdrop-blur-xs hover:bg-accent/80 text-xs font-semibold"
            >
              <Link href="/settings/notifications">
                <BellRing className="h-3.5 w-3.5 text-primary" />
                Configure Providers
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 border-border/80 bg-background/80 shadow-xs backdrop-blur-xs hover:bg-accent/80 text-xs font-semibold"
            >
              <Link href="/settings/notifications/history">
                <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                Delivery History
              </Link>
            </Button>
          </div>
        }
      />

      <NotificationOperations canRetry={user.role === 'ADMIN'} />
    </div>
  );
}
