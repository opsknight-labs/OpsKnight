import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import SystemNotificationSettings from '@/components/settings/SystemNotificationSettings';
import { getNotificationProviders } from '@/app/(app)/settings/system/actions';
import { ShieldCheck, Activity, Radio, RadioTower, Mail, BellRing, AlertOctagon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';

export default async function NotificationProviderSettingsPage() {
  const permissions = await getUserPermissions();

  if (!permissions.isAdmin) {
    redirect('/settings');
  }

  const providers = await getNotificationProviders();

  // 1. SMS Check (Twilio or AWS SNS)
  const twilio = providers.find(p => p.provider === 'twilio');
  const twilioConfig = (twilio?.config as Record<string, unknown>) || {};
  const isTwilioValid = Boolean(
    twilioConfig.accountSid &&
    twilioConfig.authToken &&
    twilioConfig.fromNumber &&
    !String(twilioConfig.accountSid).startsWith('enc:') &&
    !String(twilioConfig.authToken).startsWith('enc:')
  );
  const isTwilioActive = Boolean(twilio?.enabled && isTwilioValid);

  const awsSns = providers.find(p => p.provider === 'aws-sns');
  const awsSnsConfig = (awsSns?.config as Record<string, unknown>) || {};
  const isAwsSnsValid = Boolean(
    awsSnsConfig.accessKeyId &&
    awsSnsConfig.secretAccessKey &&
    !String(awsSnsConfig.accessKeyId).startsWith('enc:') &&
    !String(awsSnsConfig.secretAccessKey).startsWith('enc:')
  );
  const isAwsSnsActive = Boolean(awsSns?.enabled && isAwsSnsValid);

  const isSmsActive = isTwilioActive || isAwsSnsActive;
  const activeSmsName = isTwilioActive ? 'Twilio' : (isAwsSnsActive ? 'Amazon SNS' : 'None');

  // 2. WhatsApp Check
  const whatsappAccountSid = (twilioConfig.whatsappAccountSid || twilioConfig.accountSid) as string | undefined;
  const whatsappAuthToken = (twilioConfig.whatsappAuthToken || twilioConfig.authToken) as string | undefined;
  const isWhatsappValid = Boolean(
    twilioConfig.whatsappNumber &&
    whatsappAccountSid &&
    whatsappAuthToken &&
    !String(whatsappAccountSid).startsWith('enc:') &&
    !String(whatsappAuthToken).startsWith('enc:')
  );
  const isWhatsappActive = Boolean(twilioConfig.whatsappEnabled && isWhatsappValid);
  const activeWhatsappName = isWhatsappActive ? 'Twilio' : 'Disabled';

  // 3. Web Push Check
  const webPush = providers.find(p => p.provider === 'web-push');
  const webPushConfig = (webPush?.config as Record<string, unknown>) || {};
  const isWebPushValid = Boolean(
    webPushConfig.vapidPublicKey &&
    webPushConfig.vapidPrivateKey &&
    !String(webPushConfig.vapidPrivateKey).startsWith('enc:')
  );
  const isWebPushActive = Boolean(webPush?.enabled && isWebPushValid);
  const activeWebPushName = isWebPushActive ? 'Enabled' : 'Disabled';

  // 4. Email Check & Route
  const emailProviderKeys = ['resend', 'sendgrid', 'ses', 'smtp'];
  const formatEmailLabel = (k: string) => {
    switch (k.toLowerCase()) {
      case 'resend': return 'Resend';
      case 'sendgrid': return 'SendGrid';
      case 'ses': return 'SES';
      case 'smtp': return 'SMTP';
      default: return k.toUpperCase();
    }
  };
  const isEmailValid = (key: string) => {
    const p = providers.find(item => item.provider === key);
    const cfg = (p?.config as Record<string, unknown>) || {};
    if (key === 'resend' || key === 'sendgrid') {
      return Boolean(cfg.apiKey && cfg.fromEmail && !String(cfg.apiKey).startsWith('enc:'));
    }
    if (key === 'ses') {
      return Boolean(
        cfg.accessKeyId &&
        cfg.secretAccessKey &&
        cfg.fromEmail &&
        !String(cfg.accessKeyId).startsWith('enc:') &&
        !String(cfg.secretAccessKey).startsWith('enc:')
      );
    }
    if (key === 'smtp') {
      return Boolean(
        cfg.host &&
        cfg.port &&
        cfg.user &&
        cfg.password &&
        cfg.fromEmail &&
        !String(cfg.password).startsWith('enc:')
      );
    }
    return false;
  };

  const activeEmailProviders = emailProviderKeys.filter(
    key => (providers.find(p => p.provider === key)?.enabled ?? false) && isEmailValid(key)
  );
  const isEmailActive = activeEmailProviders.length > 0;
  const emailRouteSummary = activeEmailProviders.length > 0
    ? activeEmailProviders.map(formatEmailLabel).join(' → ')
    : 'None';

  // Total Channels Active
  const activeChannelsCount =
    (isSmsActive ? 1 : 0) +
    (isWhatsappActive ? 1 : 0) +
    (isEmailActive ? 1 : 0) +
    (isWebPushActive ? 1 : 0);

  // Total Configured Providers
  const totalConfiguredProviders =
    (isTwilioValid ? 1 : 0) +
    (isAwsSnsValid ? 1 : 0) +
    (isWhatsappValid ? 1 : 0) +
    (isWebPushValid ? 1 : 0) +
    emailProviderKeys.filter(isEmailValid).length;

  // Active / Enabled Provider Gateways Count
  const enabledGatewaysCount =
    (isTwilioActive ? 1 : 0) +
    (isAwsSnsActive ? 1 : 0) +
    (isWhatsappActive ? 1 : 0) +
    (isWebPushActive ? 1 : 0) +
    activeEmailProviders.length;

  // Configuration Issues Count
  const isTwilioErr = Boolean(twilio?.enabled && !isTwilioValid);
  const isAwsSnsErr = Boolean(awsSns?.enabled && !isAwsSnsValid);
  const isWhatsappErr = Boolean(twilioConfig.whatsappEnabled && !isWhatsappValid);
  const isWebPushErr = Boolean(webPush?.enabled && !isWebPushValid);
  const emailErrors = emailProviderKeys.filter(
    key => (providers.find(p => p.provider === key)?.enabled ?? false) && !isEmailValid(key)
  ).length;

  const configurationIssues =
    (isTwilioErr ? 1 : 0) +
    (isAwsSnsErr ? 1 : 0) +
    (isWhatsappErr ? 1 : 0) +
    (isWebPushErr ? 1 : 0) +
    emailErrors;

  return (
    <div className="space-y-6">
      {/* 1. Outbound Delivery Hero Banner */}
      <DetailHeroBanner
        tag="Outbound Delivery"
        title="Notification Providers"
        subtitle="Configure SMS (Twilio, Amazon SNS), Email (Resend/SendGrid/SES/SMTP), Web Push, and WhatsApp Business outbound gateways."
        icon={
          <div className="p-3 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 shadow-inner">
            <BellRing className="h-7 w-7" />
          </div>
        }
        badges={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Outbound Delivery
            </Badge>
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold"
            >
              {activeChannelsCount}/4 Channels Available
            </Badge>
            <Badge
              variant="outline"
              className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs font-semibold"
            >
              {totalConfiguredProviders} Providers Configured
            </Badge>
          </div>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
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
                My Delivery History
              </Link>
            </Button>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Channels Available',
            value: `${activeChannelsCount} / 4`,
            icon: <BellRing className="h-3.5 w-3.5" />,
            subtext: activeChannelsCount === 4 ? 'All channels covered' : `${4 - activeChannelsCount} inactive`,
          },
          {
            label: 'Enabled Providers',
            value: `${enabledGatewaysCount}`,
            icon: <RadioTower className="h-3.5 w-3.5" />,
            subtext: `${totalConfiguredProviders} configured in vault`,
          },
          {
            label: 'Email Route',
            value: emailRouteSummary,
            icon: <Mail className="h-3.5 w-3.5" />,
            subtext: activeEmailProviders.length > 1
              ? `${activeEmailProviders.length} gateways with failover`
              : activeEmailProviders.length === 1
                ? 'Single provider (no failover)'
                : 'Email dispatch offline',
          },
          {
            label: 'Configuration Health',
            value: configurationIssues === 0 ? 'Optimal' : `${configurationIssues} Issue${configurationIssues > 1 ? 's' : ''}`,
            icon: configurationIssues === 0 ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> : <AlertOctagon className="h-3.5 w-3.5 text-amber-400" />,
            subtext: configurationIssues === 0 ? 'All enabled gateways valid' : 'Missing credentials detected',
          },
        ]}
      />

      {/* 2. Runtime Overview Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl border border-border/80 bg-card shadow-xs text-xs">
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">Email Route</span>
          <span className="font-semibold text-foreground truncate block mt-0.5" title={emailRouteSummary}>
            {emailRouteSummary}
          </span>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">SMS Provider</span>
          <span className="font-semibold text-foreground truncate block mt-0.5">
            {activeSmsName}
          </span>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">WhatsApp</span>
          <span className="font-semibold text-foreground truncate block mt-0.5">
            {activeWhatsappName}
          </span>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">Web Push</span>
          <span className="font-semibold text-foreground truncate block mt-0.5">
            {activeWebPushName}
          </span>
        </div>
      </div>

      {/* 3. Categorized Provider Gateway Cards */}
      <SystemNotificationSettings providers={providers} />
    </div>
  );
}
