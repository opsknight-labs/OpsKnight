'use client';

import { useState } from 'react';
import ProviderCard from '@/components/settings/ProviderCard';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import type { ProviderRecord, ProviderConfigSchema } from '@/types/notification-types';

interface SystemNotificationSettingsProps {
  providers: ProviderRecord[];
}

// Provider configuration schemas
const providerConfigs: ProviderConfigSchema[] = [
  {
    key: 'twilio',
    name: 'Twilio (SMS)',
    description: 'Send SMS notifications via Twilio',
    fields: [
      {
        name: 'accountSid',
        label: 'Account SID',
        type: 'text',
        required: true,
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        name: 'authToken',
        label: 'Auth Token',
        type: 'password',
        required: true,
        placeholder: 'Your Twilio auth token',
      },
      {
        name: 'fromNumber',
        label: 'From Phone Number',
        type: 'tel',
        required: true,
        placeholder: '+1234567890',
      },
    ],
  },
  {
    key: 'aws-sns',
    name: 'Amazon SNS (SMS)',
    description: 'Send SMS notifications via Amazon Simple Notification Service',
    fields: [
      {
        name: 'region',
        label: 'AWS Region',
        type: 'text',
        required: true,
        placeholder: 'us-east-1',
      },
      {
        name: 'accessKeyId',
        label: 'Access Key ID',
        type: 'text',
        required: true,
        placeholder: 'AKIAXXXXXXXXXXXXXXXX',
      },
      {
        name: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'password',
        required: true,
        placeholder: 'Your AWS secret access key',
      },
    ],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp (via Twilio)',
    description: 'Send WhatsApp notifications via Twilio WhatsApp Business API',
    fields: [
      {
        name: 'whatsappNumber',
        label: 'WhatsApp Business Number',
        type: 'tel',
        required: true,
        placeholder: 'whatsapp:+14155238886',
      },
      {
        name: 'whatsappContentSid',
        label: 'WhatsApp Template SID (Optional)',
        type: 'text',
        required: false,
        placeholder: 'HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        name: 'whatsappAccountSid',
        label: 'Account SID (Optional - overrides Twilio SMS config)',
        type: 'text',
        required: false,
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        name: 'whatsappAuthToken',
        label: 'Auth Token (Optional - overrides Twilio SMS config)',
        type: 'password',
        required: false,
        placeholder: 'Your Twilio auth token',
      },
    ],
    requiresProvider: 'twilio',
  },
  {
    key: 'resend',
    name: 'Resend (Email)',
    description: 'Send emails via Resend API',
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 're_xxxxxxxxxxxx',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        required: true,
        placeholder: 'noreply@OpsKnight.com',
      },
    ],
  },
  {
    key: 'sendgrid',
    name: 'SendGrid (Email)',
    description: 'Send emails via SendGrid API',
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'SG.xxxxxxxxxxxx',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        required: true,
        placeholder: 'noreply@OpsKnight.com',
      },
    ],
  },
  {
    key: 'smtp',
    name: 'SMTP (Email)',
    description: 'Send emails via generic SMTP server',
    fields: [
      {
        name: 'host',
        label: 'SMTP Host',
        type: 'text',
        required: true,
        placeholder: 'smtp.example.com',
      },
      {
        name: 'port',
        label: 'Port',
        type: 'number',
        required: true,
        placeholder: '587',
      },
      {
        name: 'user',
        label: 'Username',
        type: 'text',
        required: true,
        placeholder: 'user@example.com',
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        required: true,
        placeholder: 'Your SMTP password',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        required: true,
        placeholder: 'noreply@OpsKnight.com',
      },
      { name: 'secure', label: 'Use TLS/SSL', type: 'checkbox', required: false },
    ],
  },
  {
    key: 'ses',
    name: 'Amazon SES (Email)',
    description: 'Send emails via Amazon Simple Email Service',
    fields: [
      {
        name: 'accessKeyId',
        label: 'Access Key ID',
        type: 'text',
        required: true,
        placeholder: 'AKIAXXXXXXXXXXXXXXXX',
      },
      {
        name: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'password',
        required: true,
        placeholder: 'Your AWS secret access key',
      },
      {
        name: 'region',
        label: 'AWS Region',
        type: 'text',
        required: true,
        placeholder: 'us-east-1',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        required: true,
        placeholder: 'noreply@OpsKnight.com',
      },
    ],
  },
  {
    key: 'web-push',
    name: 'Web Push (PWA)',
    description: 'Send native PWA Push Notifications (Standard Web Push)',
    fields: [
      {
        name: 'vapidPublicKey',
        label: 'VAPID Public Key',
        type: 'text',
        required: true,
        placeholder: 'BFRf...',
      },
      {
        name: 'vapidPrivateKey',
        label: 'VAPID Private Key',
        type: 'password',
        required: true,
        placeholder: 'Private key (secret)',
      },
      {
        name: 'vapidSubject',
        label: 'Contact Email (mailto:)',
        type: 'text',
        required: true,
        placeholder: 'mailto:admin@example.com',
      },
    ],
  },
];

export default function SystemNotificationSettings({ providers }: SystemNotificationSettingsProps) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const providerMap = new Map(providers.map(p => [p.provider, p]));

  // For WhatsApp, we need to read from Twilio provider config
  const twilioProvider = providerMap.get('twilio');
  const twilioConfig = (twilioProvider?.config as Record<string, unknown>) || {};
  const isTwilioConfigured = Boolean(
    twilioConfig.accountSid &&
    twilioConfig.authToken &&
    twilioConfig.fromNumber &&
    !String(twilioConfig.accountSid).startsWith('enc:') &&
    !String(twilioConfig.authToken).startsWith('enc:')
  );

  const awsSnsProvider = providerMap.get('aws-sns');
  const awsSnsConfig = (awsSnsProvider?.config as Record<string, unknown>) || {};
  const isAwsSnsConfigured = Boolean(
    awsSnsConfig.accessKeyId &&
    awsSnsConfig.secretAccessKey &&
    !String(awsSnsConfig.accessKeyId).startsWith('enc:') &&
    !String(awsSnsConfig.secretAccessKey).startsWith('enc:')
  );

  const whatsappConfig = twilioProvider?.config as Record<string, unknown> | undefined;
  const whatsappAccountSid = (whatsappConfig?.whatsappAccountSid || twilioConfig?.accountSid) as string | undefined;
  const whatsappAuthToken = (whatsappConfig?.whatsappAuthToken || twilioConfig?.authToken) as string | undefined;
  const isWhatsappConfigured = Boolean(
    whatsappConfig?.whatsappNumber &&
    whatsappAccountSid &&
    whatsappAuthToken &&
    !String(whatsappAccountSid).startsWith('enc:') &&
    !String(whatsappAuthToken).startsWith('enc:')
  );
  const whatsappEnabled = Boolean(whatsappConfig?.whatsappEnabled && whatsappConfig?.whatsappNumber);

  const pushProvider = providerMap.get('web-push');
  const pushConfig = (pushProvider?.config as Record<string, unknown>) || {};
  const isPushConfigured = Boolean(
    pushConfig.vapidPublicKey &&
    pushConfig.vapidPrivateKey &&
    !String(pushConfig.vapidPrivateKey).startsWith('enc:')
  );

  // Email route resolution
  const emailKeys = ['resend', 'sendgrid', 'ses', 'smtp'];
  const isEmailConfigured = (key: string) => {
    const p = providerMap.get(key);
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

  const activeEmailKeys = emailKeys.filter(
    key => (providerMap.get(key)?.enabled ?? false) && isEmailConfigured(key)
  );

  const getProviderStatusRole = (key: string) => {
    if (emailKeys.includes(key)) {
      const p = providerMap.get(key);
      const isEnabled = p?.enabled ?? false;
      const isCfg = isEmailConfigured(key);
      if (isEnabled) {
        if (!isCfg) return 'configuration_error' as const;
        const rank = activeEmailKeys.indexOf(key);
        if (rank === 0) return 'primary' as const;
        if (rank === 1) return 'fallback_1' as const;
        if (rank === 2) return 'fallback_2' as const;
        return 'fallback_3' as const;
      }
      return isCfg ? ('standby' as const) : ('not_configured' as const);
    }

    if (key === 'twilio') {
      const isEnabled = twilioProvider?.enabled ?? false;
      if (isEnabled) {
        return isTwilioConfigured ? ('active' as const) : ('configuration_error' as const);
      }
      return isTwilioConfigured ? ('standby' as const) : ('not_configured' as const);
    }

    if (key === 'aws-sns') {
      const isEnabled = awsSnsProvider?.enabled ?? false;
      if (isEnabled) {
        if (!isAwsSnsConfigured) return 'configuration_error' as const;
        const isTwilioActive = (twilioProvider?.enabled ?? false) && isTwilioConfigured;
        return isTwilioActive ? ('standby' as const) : ('active' as const);
      }
      return isAwsSnsConfigured ? ('standby' as const) : ('not_configured' as const);
    }

    if (key === 'whatsapp') {
      if (whatsappEnabled) {
        return isWhatsappConfigured ? ('active' as const) : ('configuration_error' as const);
      }
      return isWhatsappConfigured ? ('standby' as const) : ('not_configured' as const);
    }

    if (key === 'web-push') {
      const isEnabled = pushProvider?.enabled ?? false;
      if (isEnabled) {
        return isPushConfigured ? ('active' as const) : ('configuration_error' as const);
      }
      return isPushConfigured ? ('standby' as const) : ('not_configured' as const);
    }

    return 'not_configured' as const;
  };

  // WhatsApp shares the Twilio persistence record, including its serialized
  // updatedAt revision used for optimistic concurrency.
  const whatsappProvider: ProviderRecord | undefined =
    twilioProvider && whatsappConfig?.whatsappNumber
      ? {
          id: twilioProvider.id,
          provider: 'whatsapp',
          enabled: whatsappEnabled,
          config: {
            whatsappNumber: whatsappConfig.whatsappNumber,
            whatsappEnabled: whatsappConfig.whatsappEnabled,
            whatsappContentSid: whatsappConfig.whatsappContentSid,
            whatsappAccountSid: whatsappConfig.whatsappAccountSid,
            whatsappAuthToken: whatsappConfig.whatsappAuthToken,
          },
          updatedAt: twilioProvider.updatedAt,
        }
      : undefined;

  const categories = [
    {
      title: 'SMS Messaging',
      description:
        'Outbound SMS text message dispatch for high-priority incidents and on-call paging via Twilio or AWS SNS.',
      keys: ['twilio', 'aws-sns'],
    },
    {
      title: 'WhatsApp Business Messaging',
      description:
        'Interactive WhatsApp alert templates and conversational responder acknowledgments via Twilio Business API.',
      keys: ['whatsapp'],
    },
    {
      title: 'Transactional Email Gateways',
      description:
        'Primary and fallback SMTP/API providers for rich HTML incident alerts, postmortems, and team invites.',
      keys: ['resend', 'sendgrid', 'ses', 'smtp'],
    },
    {
      title: 'Native Browser Push (PWA)',
      description:
        'Encrypted Web Push notifications (VAPID) for real-time mobile and desktop browser alerts.',
      keys: ['web-push'],
    },
  ];

  return (
    <div className="space-y-6">
      {categories.map(category => {
        const matchingConfigs = providerConfigs.filter(cfg => category.keys.includes(cfg.key));
        if (matchingConfigs.length === 0) return null;

        const activeCount = matchingConfigs.filter(cfg => {
          const role = getProviderStatusRole(cfg.key);
          return role === 'primary' || role === 'active' || role.startsWith('fallback');
        }).length;
        const totalCount = matchingConfigs.length;

        const activeBadge = (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              activeCount > 0
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                : 'bg-muted text-muted-foreground border-border/80'
            }`}
          >
            {activeCount}/{totalCount} active
          </span>
        );

        return (
          <SettingsSection
            key={category.title}
            title={category.title}
            description={category.description}
            action={activeBadge}
          >
            <div className="py-4 grid grid-cols-1 gap-3.5">
              {matchingConfigs.map(providerConfig => {
                const existing =
                  providerConfig.key === 'whatsapp'
                    ? whatsappProvider
                    : providerMap.get(providerConfig.key);
                const isExpanded = expandedProvider === providerConfig.key;
                const statusRole = getProviderStatusRole(providerConfig.key);

                return (
                  <ProviderCard
                    key={providerConfig.key}
                    providerConfig={providerConfig}
                    existing={existing}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedProvider(isExpanded ? null : providerConfig.key)}
                    twilioProvider={providerConfig.key === 'whatsapp' ? twilioProvider : undefined}
                    statusRole={statusRole}
                  />
                );
              })}
            </div>
          </SettingsSection>
        );
      })}
    </div>
  );
}