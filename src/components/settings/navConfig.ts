export type SettingsNavItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: string;
  keywords?: string[];
  requiresAdmin?: boolean;
  requiresAdminOrAuditor?: boolean;
  requiresResponder?: boolean;
  badge?: string;
};

export type SettingsNavSection = {
  id: string;
  label: string;
  description?: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        id: 'settings-overview',
        label: 'Settings Home',
        description: 'Find and manage all workspace settings',
        href: '/settings',
        icon: 'home',
        keywords: ['overview', 'dashboard', 'settings'],
      },
    ],
  },
  {
    id: 'account',
    label: 'Account & Identity',
    description: 'Personal profile, security credentials, active sessions, and quiet hours',
    items: [
      {
        id: 'profile',
        label: 'Profile & Preferences',
        description: 'Personal info, timezone, notification delivery rules, and quiet hours',
        href: '/settings/profile',
        icon: 'user',
        keywords: [
          'name',
          'email',
          'role',
          'timezone',
          'notifications',
          'quiet hours',
          'mute alerts',
          'low urgency',
        ],
      },
      {
        id: 'security',
        label: 'Security & Sessions',
        description: 'Password credentials, active login sessions, and session revocation',
        href: '/settings/security',
        icon: 'shield',
        keywords: ['password', 'sessions', 'mfa', 'security', 'auth'],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace & Governance',
    description: 'Incident custom metadata, public status page branding, and access tokens',
    items: [
      {
        id: 'custom-fields',
        label: 'Custom Fields',
        description: 'Define custom incident metadata, dropdown attributes, and validation rules',
        href: '/settings/custom-fields',
        icon: 'list',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: ['metadata', 'incident', 'fields', 'custom'],
      },
      {
        id: 'status-page',
        label: 'Public Status Page',
        description: 'Customize public status page appearance, custom domains, and announcements',
        href: '/settings/status-page',
        icon: 'globe',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: ['public', 'status', 'branding', 'domain'],
      },
      {
        id: 'api-keys',
        label: 'API Keys & Access Tokens',
        description: 'Generate, rotate, and manage programmatic API keys and integration tokens',
        href: '/settings/api-keys',
        icon: 'key',
        requiresAdmin: false,
        keywords: ['token', 'automation', 'api', 'keys', 'rest'],
      },
      {
        id: 'audit-logs',
        label: 'Audit Log Stream',
        description: 'Inspect workspace change logs, security events, and compliance audit trail',
        href: '/audit',
        icon: 'activity',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: ['audit', 'history', 'events', 'compliance', 'security'],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations & ChatOps',
    description: 'Connect alert sources, Slack war rooms, and ticketing integrations',
    items: [
      {
        id: 'integrations',
        label: 'Integrations Catalog',
        description:
          'Explore and manage incoming alert integrations, monitoring tools, and webhooks',
        href: '/settings/integrations',
        icon: 'plug',
        keywords: [
          'slack',
          'webhooks',
          'connect',
          'datadog',
          'prometheus',
          'grafana',
          'cloudwatch',
        ],
      },
      {
        id: 'slack',
        label: 'Slack Workspace',
        description: 'Connect Slack OAuth workspace for automatic incident alert broadcast',
        href: '/settings/integrations/slack',
        icon: 'slack',
        keywords: ['alerts', 'channels', 'slack', 'bot'],
      },
      {
        id: 'chatops',
        label: 'ChatOps War-Rooms',
        description:
          'Auto-create dedicated Slack channels and conference bridges for critical incidents',
        href: '/settings/integrations/chatops',
        icon: 'message-circle',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: ['war room', 'channel', 'chatops', 'slack', 'video', 'bridge'],
      },
    ],
  },
  {
    id: 'system',
    label: 'Platform & Reliability',
    description: 'System diagnostics, data retention policies, and notification providers',
    items: [
      {
        id: 'health-center',
        label: 'System Health Center',
        description:
          'Inspect database health, background job workers, Redis queue, and SLA monitors',
        href: '/settings/system/health',
        icon: 'activity',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: [
          'health',
          'database',
          'scheduler',
          'performance',
          'metrics',
          'sla',
          'migration',
          'upgrade',
        ],
      },
      {
        id: 'system',
        label: 'System Settings',
        description:
          'Application base URL, data retention periods, and general platform parameters',
        href: '/settings/system',
        icon: 'settings',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: ['app url', 'providers', 'retention', 'data'],
      },
      {
        id: 'notifications-admin',
        label: 'Notification Providers',
        description: 'Configure Twilio SMS, AWS SNS, WhatsApp Business, and Web Push VAPID keys',
        href: '/settings/notifications',
        icon: 'bell',
        requiresAdmin: true,
        badge: 'Admin',
        keywords: ['twilio', 'push', 'sms', 'whatsapp', 'vapid', 'sns'],
      },
      {
        id: 'notification-operations',
        label: 'Notification Operations',
        description: 'Workspace delivery health, failures, and retries',
        href: '/settings/notifications/operations',
        icon: 'activity',
        requiresAdminOrAuditor: true,
        badge: 'Admin/Auditor',
        keywords: ['delivery', 'operations', 'failures', 'retries', 'dead letter'],
      },
      {
        id: 'notification-history',
        label: 'Notification Delivery Log',
        description: 'Track delivery timestamps, dispatch status, provider responses, and failures',
        href: '/settings/notifications/history',
        icon: 'bell',
        keywords: ['delivery', 'history', 'logs', 'sms', 'email', 'push'],
      },
    ],
  },
];

export const SETTINGS_NAV_ITEMS = SETTINGS_NAV_SECTIONS.flatMap(section => section.items);
