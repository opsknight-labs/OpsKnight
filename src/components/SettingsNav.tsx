'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Props = {
  isAdmin?: boolean;
};

export default function SettingsNav({ isAdmin = false }: Props) {
  const pathname = usePathname();

  const navItems = [
    {
      href: '/settings/profile',
      label: 'Profile',
      description: 'Personal info, timezone, and notifications',
    },
    { href: '/settings/security', label: 'Security', description: 'Password and sessions' },
    { href: '/settings/api-keys', label: 'API keys', description: 'Integration credentials' },
    {
      href: '/settings/custom-fields',
      label: 'Custom Fields',
      description: 'Define custom fields for incidents (Admin only)',
      adminOnly: true,
      disabled: !isAdmin,
    },
    {
      href: '/settings/status-page',
      label: 'Status Page',
      description: 'Public status page configuration (Admin only)',
      adminOnly: true,
      disabled: !isAdmin,
    },
    {
      href: '/settings/notifications',
      label: 'Notification Providers',
      description: 'Configure SMS and push providers (Admin only)',
      adminOnly: true,
      disabled: !isAdmin,
    },
    {
      href: '/settings/notifications/history',
      label: 'Notification History',
      description: 'View notification delivery history',
    },
    {
      href: '/settings/slack-oauth',
      label: 'Slack OAuth',
      description: 'Configure Slack OAuth credentials (Admin only)',
      adminOnly: true,
      disabled: !isAdmin,
    },
  ];

  return (
    <nav className="settings-nav">
      {navItems.map(item => {
        const active = pathname === item.href;
        const isDisabled = (item as any).disabled; // eslint-disable-line @typescript-eslint/no-explicit-any

        if (isDisabled) {
          return (
            <div
              key={item.href}
              className="settings-link"
              style={{
                opacity: 0.6,
                cursor: 'not-allowed',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
              }}
              title="Admin role required"
            >
              <span className="settings-link-label" style={{ color: 'var(--text-muted)' }}>
                {item.label}
              </span>
              <span className="settings-link-desc" style={{ color: 'var(--text-muted)' }}>
                {item.description}
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: '#dc2626',
                  marginTop: '0.25rem',
                  fontStyle: 'italic',
                }}
              >
                Admin required
              </span>
            </div>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`settings-link ${active ? 'active' : ''}`}
          >
            <span className="settings-link-label">{item.label}</span>
            <span className="settings-link-desc">{item.description}</span>
          </Link>
        );
      })}
    </nav>
  );
}
