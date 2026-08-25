export type SettingsNavItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: string;
  keywords?: string[];
  requiresAdmin?: boolean;
  requiresResponder?: boolean;
};

export type SettingsNavSection = {
  id: string;
  label: string;
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
    label: 'Account',
    items: [
      {
        id: 'profile',
        label: 'Profile',
        description: 'Personal info, timezone, and notifications',
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
        label: 'Security',
        description: 'Password and sessions',
        href: '/settings/security',
        icon: 'shield',
        keywords: ['password', 'sessions', 'mfa'],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'custom-fields',
        label: 'Custom Fields',
        description: 'Define extra incident metadata',
        href: '/settings/custom-fields',
        icon: 'list',
        requiresAdmin: true,
        keywords: ['metadata', 'incident'],
      },
      {
        id: 'status-page',
        label: 'Status Page',
        description: 'Customize your public status page',
        href: '/settings/status-page',
        icon: 'globe',
        requiresAdmin: true,
        keywords: ['public', 'status', 'branding'],
      },
      {
        id: 'health-center',
        label: 'Health Center',
        description: 'Database, workers, paging, providers, performance, and upgrades',
        href: '/settings/system/health',
        icon: 'activity',
        requiresAdmin: true,
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
        description: 'Application-wide configuration',
        href: '/settings/system',
        icon: 'settings',
        requiresAdmin: true,
        keywords: ['app url', 'providers'],
      },
      {
        id: 'notifications-admin',
        label: 'Notification Providers',
        description: 'SMS, push, and WhatsApp setup',
        href: '/settings/notifications',
        icon: 'bell',
        requiresAdmin: true,
        keywords: ['twilio', 'push', 'sms'],
      },
      {
        id: 'audit-logs',
        label: 'Audit Logs',
        description: 'Track critical changes across the workspace',
        href: '/audit',
        icon: 'activity',
        requiresAdmin: true,
        keywords: ['audit', 'history', 'events'],
      },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    items: [
      {
        id: 'notification-history',
        label: 'Notification History',
        description: 'Delivery status and recent sends',
        href: '/settings/notifications/history',
        icon: 'bell',
        keywords: ['delivery', 'history', 'logs'],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [
      {
        id: 'integrations',
        label: 'Integrations',
        description: 'Connect OpsKnight with your tools',
        href: '/settings/integrations',
        icon: 'plug',
        keywords: ['slack', 'webhooks', 'connect'],
      },
      {
        id: 'slack',
        label: 'Slack',
        description: 'Send incident alerts to Slack',
        href: '/settings/integrations/slack',
        icon: 'slack',
        keywords: ['alerts', 'channels'],
      },
      {
        id: 'chatops',
        label: 'ChatOps War-Rooms',
        description: 'Auto-create Slack channels for critical incidents',
        href: '/settings/integrations/chatops',
        icon: 'message-circle',
        requiresAdmin: true,
        keywords: ['war room', 'channel', 'chatops', 'slack', 'video', 'bridge'],
      },
    ],
  },
  {
    id: 'developer',
    label: 'Developer',
    items: [
      {
        id: 'api-keys',
        label: 'API Keys',
        description: 'Create and manage integration keys',
        href: '/settings/api-keys',
        icon: 'key',
        keywords: ['token', 'automation'],
      },
    ],
  },
];

export const SETTINGS_NAV_ITEMS = SETTINGS_NAV_SECTIONS.flatMap(section => section.items);
