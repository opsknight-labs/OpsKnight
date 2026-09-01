import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import SystemNotificationSettings from '@/components/settings/SystemNotificationSettings';
import { getNotificationProviders } from '@/app/(app)/settings/system/actions';
import { BellRing, Activity, Radio } from 'lucide-react';
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
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Notification Providers',
        }}
        tag="Alerting & Outbound Delivery"
        title="Notification Providers"
        subtitle="Configure SMS (Twilio/SNS), Email (Resend/SendGrid/SES/SMTP), Web Push (VAPID), and WhatsApp Business outbound delivery gateways."
        icon={<BellRing className="h-6 w-6 text-primary" />}
        badges={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-semibold">
              Enterprise Alerting
            </Badge>
            <Badge variant="secondary" className="text-xs font-semibold">
              {activeChannelsCount} Active Channel{activeChannelsCount === 1 ? '' : 's'}
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
              <Link href="/settings/notifications/operations">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Delivery Operations
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
        stats={[
          {
            label: 'Active Gateways',
            value: `${activeProvidersCount + (isWhatsappActive ? 1 : 0)}`,
            subtext: 'Providers routing live traffic',
          },
          {
            label: 'Active Channels',
            value: `${activeChannelsCount} / 4`,
            subtext: 'SMS, WhatsApp, Email, Push',
          },
          {
            label: 'Email Gateway',
            value: activeEmailProvider ? activeEmailProvider.provider.toUpperCase() : 'None',
            subtext: activeEmailProvider ? 'Outbound primary sender' : 'Configure Resend/SES/SMTP',
          },
          {
            label: 'Credential Vault',
            value: 'AES-GCM-256',
            subtext: 'Encrypted hardware storage',
          },
        ]}
      />

      <SystemNotificationSettings providers={providers} />
    </div>
  );
}
