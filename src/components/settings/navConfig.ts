export type SettingsNavItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: string;
  keywords?: string[];
  /** Visibility comes from the page access registry (`@/lib/access/pages`) using `href`. */
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
      {
        id: 'my-access',
        label: 'My Access',
        description: 'Your role, teams and permissions, temporary access, and access requests',
        href: '/settings/access',
        icon: 'key',
        keywords: ['access', 'permissions', 'role', 'request access', 'why can’t i', 'denied'],
      },
      {
        id: 'access-requests',
        label: 'Access Requests',
        description: 'Review requests from people who need access to your teams or a new role',
        href: '/settings/access/requests',
        icon: 'users',
        keywords: ['approve', 'access request', 'grant', 'join team'],
      },
      {
        id: 'access-admin',
        label: 'Access Management',
        description:
          'Roles, custom roles, access checker, access reviews, emergency access and policy',
        href: '/settings/access/admin',
        icon: 'shield',
        badge: 'Admin',
        keywords: ['rbac', 'custom role', 'access review', 'break glass', 'who has access'],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace & Governance',
    description: 'Incident custom metadata, public status page branding, and access tokens',
    items: [
      {
        id: 'incident-sla',
        label: 'Incident Response Policy',
        description:
          'Configure alert classification, priority and urgency semantics, and immutable incident response SLA targets',
        href: '/settings/incident-sla',
        icon: 'activity',
        badge: 'Admin',
        keywords: [
          'sla',
          'incident',
          'acknowledgement',
          'resolution',
          'priority',
          'urgency',
          'severity',
          'classification',
          'response policy',
        ],
      },
      {
        id: 'service-objectives',
        label: 'Service Objectives',
        description: 'Versioned uptime and response-time targets',
        href: '/settings/service-objectives',
        icon: 'activity',
        keywords: ['slo', 'objectives', 'uptime', 'availability', 'mtta', 'mttr'],
      },
      {
        id: 'custom-fields',
        label: 'Custom Fields',
        description: 'Define custom incident metadata, dropdown attributes, and validation rules',
        href: '/settings/custom-fields',
        icon: 'list',
        badge: 'Admin',
        keywords: ['metadata', 'incident', 'fields', 'custom'],
      },
      {
        id: 'status-page',
        label: 'Public Status Page',
        description: 'Customize public status page appearance, custom domains, and announcements',
        href: '/settings/status-pages',
        icon: 'globe',
        badge: 'Admin',
        keywords: ['public', 'status', 'branding', 'domain'],
      },
      {
        id: 'api-keys',
        label: 'API Keys & Access Tokens',
        description: 'Generate, rotate, and manage programmatic API keys and integration tokens',
        href: '/settings/api-keys',
        icon: 'key',
        keywords: ['token', 'automation', 'api', 'keys', 'rest'],
      },
      {
        id: 'audit-logs',
        label: 'Audit Log Stream',
        description: 'Inspect workspace change logs, security events, and compliance audit trail',
        href: '/audit',
        icon: 'activity',
        badge: 'Admin / Auditor',
        keywords: ['audit', 'history', 'events', 'compliance', 'security'],
      },
      {
        id: 'security-compliance',
        label: 'Security & Compliance',
        description:
          'Review control readiness, privacy inventory, CRA posture, and evidence sources',
        href: '/settings/security-compliance',
        icon: 'shield-check',
        badge: 'Admin',
        keywords: ['compliance', 'privacy', 'cra', 'gdpr', 'soc 2', 'iso', 'evidence', 'sbom'],
      },
      {
        id: 'privacy-requests',
        label: 'Privacy Requests',
        description: 'Track and fulfil data subject access, portability, and other DSAR requests',
        href: '/settings/privacy-requests',
        icon: 'shield',
        badge: 'Admin / Auditor',
        keywords: ['privacy', 'dsar', 'gdpr', 'access request', 'export', 'erasure', 'subject'],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations & ChatOps',
    description: 'Connect alert sources, Slack war rooms, ticketing and AI assistant integrations',
    items: [
      {
        id: 'slack',
        label: 'Slack Workspace',
        description: 'Connect Slack OAuth workspace for automatic incident alert broadcast',
        href: '/settings/integrations/slack',
        icon: 'slack',
        badge: 'Admin',
        keywords: ['alerts', 'channels', 'slack', 'bot', 'broadcast'],
      },
      {
        id: 'microsoft-teams',
        label: 'Microsoft Teams',
        description: 'Connect Azure AD app to broadcast incident Adaptive Cards to Teams channels',
        href: '/settings/integrations/microsoft-teams',
        icon: 'microsoft-teams',
        badge: 'Admin',
        keywords: ['alerts', 'channels', 'teams', 'microsoft', 'entra', 'adaptive card'],
      },
      {
        id: 'chatops',
        label: 'ChatOps War-Rooms',
        description:
          'Auto-create dedicated Slack channels and conference bridges for critical incidents',
        href: '/settings/integrations/chatops',
        icon: 'message-circle',
        badge: 'Admin',
        keywords: ['war room', 'channel', 'chatops', 'slack', 'video', 'bridge'],
      },
      {
        id: 'mcp',
        label: 'MCP (AI Assistants)',
        description:
          'Connect AI assistants to OpsKnight with user consent, scoped access and approved changes',
        href: '/settings/integrations/mcp',
        icon: 'bot',
        keywords: [
          'mcp',
          'ai',
          'assistant',
          'claude',
          'chatgpt',
          'cursor',
          'copilot',
          'oauth',
          'agent',
        ],
      },
      {
        id: 'jira',
        label: 'Jira Issue Tracking',
        description: 'Create and sync incident remediation work and action items in Jira',
        href: '/settings/integrations/jira',
        icon: 'jira',
        badge: 'Admin',
        keywords: ['jira', 'tickets', 'issues', 'atlassian', 'sync', 'action items'],
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
          'Inspect database health, background jobs and queues, scheduler state, notification delivery, and SLA monitors',
        href: '/settings/system/health',
        icon: 'activity',
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
        badge: 'Admin',
        keywords: ['app url', 'providers', 'retention', 'data'],
      },
      {
        id: 'system-logs',
        label: 'System Logs',
        description:
          'Inspect real-time application logs, runtime errors, and component diagnostics',
        href: '/system-logs',
        icon: 'terminal',
        badge: 'Admin',
        keywords: [
          'logs',
          'system logs',
          'diagnostics',
          'errors',
          'debug',
          'traces',
          'tail',
          'console',
        ],
      },
      {
        id: 'notifications-admin',
        label: 'Notification Providers',
        description: 'Configure Twilio SMS, AWS SNS, WhatsApp Business, and Web Push VAPID keys',
        href: '/settings/notifications',
        icon: 'bell',
        badge: 'Admin',
        keywords: ['twilio', 'push', 'sms', 'whatsapp', 'vapid', 'sns'],
      },
      {
        id: 'notification-operations',
        label: 'Notification Operations',
        description: 'Workspace delivery health, failures, and retries',
        href: '/settings/notifications/operations',
        icon: 'activity',
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
