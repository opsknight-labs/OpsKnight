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
  const whatsappConfig = twilioProvider?.config as Record<string, unknown> | undefined;
  const whatsappEnabled = !!(whatsappConfig?.whatsappEnabled && whatsappConfig?.whatsappNumber);

  // Create a virtual WhatsApp provider entry
  const whatsappProvider: ProviderRecord | undefined = whatsappConfig?.whatsappNumber
    ? {
        id: twilioProvider?.id || '',
        provider: 'whatsapp',
        enabled: whatsappEnabled,
        config: {
          whatsappNumber: whatsappConfig.whatsappNumber,
          whatsappEnabled: whatsappConfig.whatsappEnabled,
          whatsappContentSid: whatsappConfig.whatsappContentSid,
          whatsappAccountSid: whatsappConfig.whatsappAccountSid,
          whatsappAuthToken: whatsappConfig.whatsappAuthToken,
        },
        updatedAt: twilioProvider?.updatedAt || new Date(),
      }
    : undefined;

  const categories = [
    {
      title: 'SMS Messaging',
      description:
        'Outbound SMS text message dispatch for high-priority incidents and on-call paging via Twilio.',
      keys: ['twilio'],
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
          if (cfg.key === 'whatsapp') return whatsappEnabled;
          return providerMap.get(cfg.key)?.enabled ?? false;
        }).length;
        const totalCount = matchingConfigs.length;

        const sectionTitle = (
          <span className="flex items-center gap-2">
            {category.title}
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                activeCount > 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-muted text-muted-foreground border-border/80'
              }`}
            >
              {activeCount}/{totalCount} active
            </span>
          </span>
        );

        return (
          <SettingsSection
            key={category.title}
            title={sectionTitle as unknown as string}
            description={category.description}
          >
            <div className="py-4 grid grid-cols-1 gap-3.5">
              {matchingConfigs.map(providerConfig => {
                const existing =
                  providerConfig.key === 'whatsapp'
                    ? whatsappProvider
                    : providerMap.get(providerConfig.key);
                const isExpanded = expandedProvider === providerConfig.key;

                return (
                  <ProviderCard
                    key={providerConfig.key}
                    providerConfig={providerConfig}
                    existing={existing}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedProvider(isExpanded ? null : providerConfig.key)}
                    twilioProvider={providerConfig.key === 'whatsapp' ? twilioProvider : undefined}
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
