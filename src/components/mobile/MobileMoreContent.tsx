'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import MobileThemeToggle from '@/components/mobile/MobileThemeToggle';
import PushNotificationToggle from '@/components/mobile/PushNotificationToggle';
import MobileBiometricToggle from '@/components/mobile/MobileBiometricToggle';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { useUserAvatarContextSafe } from '@/contexts/UserAvatarContext';
import PwaInstallCard from '@/components/mobile/PwaInstallCard';
import MobileSignOutButton from '@/components/mobile/MobileSignOutButton';
import { APP_VERSION } from '@/lib/constants';

type Tone = 'blue' | 'teal' | 'amber' | 'green' | 'slate' | 'red';

type ShortcutItem = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  tone: Tone;
};

type ListItem = {
  href?: string;
  label: string;
  description?: string;
  icon: ReactNode;
  tone: Tone;
  rightElement?: ReactNode;
  danger?: boolean;
};

type MobileMoreContentProps = {
  userId?: string;
  name: string;
  email: string;
  role: string;
  gender?: string | null;
  avatarUrl?: string | null;
};

const chevronIcon = (
  <svg className="mobile-more-item-chevron" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M9 6l6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconTeams = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="16" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M3 20c0-3 3-5 5-5s5 2 5 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M13 20c0-2.5 2.5-4.5 5-4.5 1.5 0 3 .5 4 1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const iconUsers = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const iconSchedules = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect
      x="3"
      y="5"
      width="18"
      height="16"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M7 3v4M17 3v4M3 10h18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M8 14h4M8 17h8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const iconPolicies = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M9 12l2 2 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconAnalytics = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 19V5M4 19h16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M8 15l3-4 3 2 4-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconPostmortems = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h7l4 4v14H7z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path
      d="M9 13h6M9 17h4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const iconStatus = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 12h4l2-4 4 8 2-4h4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const iconSettings = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M4 12h2M18 12h2M12 4v2M12 18v2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M6.5 17.5l1.4-1.4M16.1 7.9l1.4-1.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const iconHelp = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M9.5 9a2.5 2.5 0 0 1 4.4 1.5c0 1.5-1.6 2-2.2 2.5-.4.4-.5.8-.5 1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <circle cx="12" cy="17.5" r="0.9" fill="currentColor" />
  </svg>
);

const iconDesktop = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect
      x="3"
      y="5"
      width="18"
      height="12"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M8 21h8M12 17v4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const iconSignOut = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M9 7V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M3 12h12M9 8l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function MobileMoreContent({
  userId,
  name,
  email,
  role,
  gender,
  avatarUrl: avatarUrlProp,
}: MobileMoreContentProps) {
  const { getAvatar } = useUserAvatarContextSafe();
  const avatarUrl = userId ? getAvatar(userId, gender, name, avatarUrlProp) : avatarUrlProp;
  const shortcuts: ShortcutItem[] = [
    {
      href: '/m/teams',
      label: 'Teams',
      description: 'On-call rosters',
      icon: iconTeams,
      tone: 'blue',
    },
    {
      href: '/m/users',
      label: 'Users',
      description: 'Directory & roles',
      icon: iconUsers,
      tone: 'teal',
    },
    {
      href: '/m/schedules',
      label: 'Schedules',
      description: 'Rotations',
      icon: iconSchedules,
      tone: 'green',
    },
    {
      href: '/m/policies',
      label: 'Policies',
      description: 'Escalations',
      icon: iconPolicies,
      tone: 'amber',
    },
  ];

  const resources: ListItem[] = [
    {
      href: '/m/analytics',
      label: 'Analytics',
      description: 'Trends & uptime',
      icon: iconAnalytics,
      tone: 'teal',
    },
    {
      href: '/m/postmortems',
      label: 'Postmortems',
      description: 'Incident reviews',
      icon: iconPostmortems,
      tone: 'amber',
    },
    {
      href: '/m/status',
      label: 'Status Page',
      description: 'System health',
      icon: iconStatus,
      tone: 'green',
    },
  ];

  const account: ListItem[] = [
    {
      href: '/settings/profile',
      label: 'Settings',
      description: 'Profile and security',
      icon: iconSettings,
      tone: 'slate',
    },
    {
      href: '/m/help',
      label: 'Help & Documentation',
      description: 'Guides and support',
      icon: iconHelp,
      tone: 'blue',
    },
  ];

  const actions: ListItem[] = [
    {
      href: '/api/prefer-desktop',
      label: 'Switch to Desktop Mode',
      description: 'Full dashboard view',
      icon: iconDesktop,
      tone: 'slate',
    },
  ];

  const renderItem = (item: ListItem) => {
    const itemClass = `mobile-more-item${item.danger ? ' danger' : ''}`;
    const iconClass = `mobile-more-icon tone-${item.tone}`;
    const content = (
      <>
        <div className={iconClass}>{item.icon}</div>
        <div className="mobile-more-item-body">
          <span className="mobile-more-item-label">{item.label}</span>
          {item.description && <span className="mobile-more-item-desc">{item.description}</span>}
        </div>
        {item.rightElement ? (
          <div className="mobile-more-item-right">{item.rightElement}</div>
        ) : (
          chevronIcon
        )}
      </>
    );

    if (item.href) {
      return (
        <Link key={item.label} href={item.href} className={itemClass}>
          {content}
        </Link>
      );
    }

    return (
      <div key={item.label} className={itemClass}>
        {content}
      </div>
    );
  };

  return (
    <div className="mobile-more-page">
      <section className="mobile-more-hero">
        <div className="mobile-more-hero-content">
          <div className="mobile-more-avatar">
            <MobileAvatar name={name} src={avatarUrl || undefined} size="xl" />
          </div>
          <div className="mobile-more-identity">
            <h1 className="mobile-more-name">{name}</h1>
            <p className="mobile-more-email">{email || 'No email on file'}</p>
            <div className="mobile-more-tags">
              <span className="mobile-more-tag">{role}</span>
            </div>
          </div>
          <div className="mobile-more-hero-actions">
            <Link href="/m/notifications" className="mobile-more-hero-button secondary">
              View Alerts
            </Link>
          </div>
        </div>
      </section>

      <section className="mobile-more-section">
        <h2 className="mobile-more-section-title">Shortcuts</h2>
        <div className="mobile-more-shortcuts">
          {shortcuts.map(item => (
            <Link key={item.label} href={item.href} className="mobile-more-tile">
              <div className={`mobile-more-tile-icon tone-${item.tone}`}>{item.icon}</div>
              <div className="mobile-more-tile-text">
                <span className="mobile-more-tile-label">{item.label}</span>
                <span className="mobile-more-tile-sub">{item.description}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mobile-more-section">
        <h2 className="mobile-more-section-title">Resources</h2>
        <div className="mobile-more-list">{resources.map(renderItem)}</div>
      </section>

      <section className="mobile-more-section">
        <h2 className="mobile-more-section-title">Preferences</h2>
        <div className="mobile-more-preferences">
          <PwaInstallCard />
          <MobileThemeToggle />
          <MobileBiometricToggle />
          <PushNotificationToggle />
        </div>
      </section>

      <section className="mobile-more-section">
        <h2 className="mobile-more-section-title">Account</h2>
        <div className="mobile-more-list">{account.map(renderItem)}</div>
      </section>

      <section className="mobile-more-section">
        <div className="mobile-more-list">{actions.map(renderItem)}</div>
        <div className="mobile-more-list" style={{ marginTop: '0.75rem' }}>
          <MobileSignOutButton
            icon={iconSignOut}
            label="Sign Out"
            description="Sign out of OpsKnight"
            tone="red"
          />
        </div>
      </section>

      <div className="mobile-more-footer">OpsKnight Mobile {APP_VERSION}</div>
    </div>
  );
}
