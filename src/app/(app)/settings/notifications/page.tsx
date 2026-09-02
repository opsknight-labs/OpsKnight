import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import SystemNotificationSettings from '@/components/settings/SystemNotificationSettings';
import { getNotificationProviders } from '@/app/(app)/settings/system/actions';
import { ShieldCheck, Activity, Radio, RadioTower, Mail, BellRing } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';

export default async function NotificationProviderSettingsPage() {
  const permissions = await getUserPermissions();

  if (!permissions.isAdmin) {
    redirect('/settings');
  }

  const providers = await getNotificationProviders();

  // Calculate stats
  const activeProvidersCount = providers.filter(p => p.enabled).length;
  const twilio = providers.find(p => p.provider === 'twilio');
  const twilioConfig = (twilio?.config as Record<string, unknown>) || {};
  const isWhatsappActive = Boolean(twilioConfig.whatsappEnabled && twilioConfig.whatsappNumber);

  const emailProviders = ['resend', 'sendgrid', 'ses', 'smtp'];
  const activeEmailProvider = providers.find(p => emailProviders.includes(p.provider) && p.enabled);

  const activeChannelsCount =
    (twilio?.enabled ? 1 : 0) +
    (isWhatsappActive ? 1 : 0) +
    (activeEmailProvider ? 1 : 0) +
    (providers.find(p => p.provider === 'web-push')?.enabled ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* 1. Simple Grey Shaded Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Notification Providers',
        }}
        tag="Alerting & Outbound Delivery"
        title="Notification Providers"
        subtitle="Configure SMS (Twilio), Email (Resend/SendGrid/SES/SMTP), Web Push (VAPID), and WhatsApp Business outbound gateways."
        icon={
          <div className="p-3 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 shadow-inner">
            <BellRing className="h-7 w-7" />
          </div>
        }
        badges={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Enterprise Alerting
            </Badge>
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold"
            >
              {activeChannelsCount} Active Channels
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
              <Link href="/settings/notifications/operations">
                <Activity className="h-3.5 w-3.5" />
                Delivery Operations
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
            >
              <Link href="/settings/notifications/history">
                <Radio className="h-3.5 w-3.5" />
                Delivery History
              </Link>
            </Button>
          </div>
        }
        stats={[
          {
            label: 'Active Gateways',
            value: `${activeProvidersCount + (isWhatsappActive ? 1 : 0)}`,
            icon: <RadioTower className="h-3.5 w-3.5" />,
            subtext: 'Routing live alerts',
          },
          {
            label: 'Coverage',
            value: `${activeChannelsCount} / 4`,
            icon: <BellRing className="h-3.5 w-3.5" />,
            subtext: 'Channels active',
          },
          {
            label: 'Primary Email',
            value: activeEmailProvider ? activeEmailProvider.provider.toUpperCase() : 'None',
            icon: <Mail className="h-3.5 w-3.5" />,
            subtext: activeEmailProvider ? 'Outbound sender' : 'Unconfigured',
          },
          {
            label: 'Vault Storage',
            value: 'AES-256',
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext: 'Encrypted hardware',
          },
        ]}
      />

      {/* 2. Categorized Provider Gateway Cards */}
      <SystemNotificationSettings providers={providers} />
    </div>
  );
}
