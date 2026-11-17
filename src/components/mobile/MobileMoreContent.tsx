'use client';

import type { ComponentType } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  FileText,
  LogOut,
  Monitor,
  Settings,
  ShieldCheck,
  Signal,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react';
import MobileThemeToggle from '@/components/mobile/MobileThemeToggle';
import PushNotificationToggle from '@/components/mobile/PushNotificationToggle';
import MobileBiometricToggle from '@/components/mobile/MobileBiometricToggle';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { useUserAvatarContextSafe } from '@/contexts/UserAvatarContext';
import PwaInstallCard from '@/components/mobile/PwaInstallCard';
import MobileSignOutButton from '@/components/mobile/MobileSignOutButton';
import {
  MobileIconTile,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import { APP_VERSION } from '@/lib/constants';
import { useEffectiveCapabilities } from '@/components/access/AccessProvider';
import { canAccessPath } from '@/lib/access/pages';
import { isAppRole } from '@/lib/authorization';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

type NavigationItem = {
  href: string;
  label: string;
  description?: string;
  icon: IconComponent;
};

type MobileMoreContentProps = {
  userId?: string;
  name: string;
  email: string;
  role: string;
  gender?: string | null;
  avatarUrl?: string | null;
};

const operations: NavigationItem[] = [
  {
    href: '/m/schedules',
    label: 'On-call',
    description: 'Schedules and rotations',
    icon: CalendarClock,
  },
  {
    href: '/m/services',
    label: 'Services',
    description: 'Service health and incidents',
    icon: Wrench,
  },
  { href: '/m/teams', label: 'Teams', description: 'Ownership and responders', icon: UsersRound },
  {
    href: '/m/policies',
    label: 'Escalation policies',
    description: 'Escalation paths',
    icon: ShieldCheck,
  },
  {
    href: '/m/postmortems',
    label: 'Postmortems',
    description: 'Reviews and follow-up work',
    icon: FileText,
  },
  { href: '/m/status', label: 'System health', description: 'Operational status', icon: Signal },
  {
    href: '/m/analytics',
    label: 'Analytics',
    description: 'Responder performance and trends',
    icon: BarChart3,
  },
  {
    href: '/m/users',
    label: 'Users',
    description: 'Directory and roles',
    icon: Users,
  },
];

const account: NavigationItem[] = [
  {
    href: '/settings/profile',
    label: 'Profile & security',
    description: 'Desktop settings: account, devices and sessions',
    icon: Settings,
  },
  {
    href: '/m/help',
    label: 'Help & documentation',
    description: 'Guides and responder help',
    icon: BookOpen,
  },
  {
    href: '/api/prefer-desktop',
    label: 'Desktop workspace',
    description: 'Open the full desktop workspace',
    icon: Monitor,
  },
];

function NavigationRow({ item }: { item: NavigationItem }) {
  return (
    <MobileListRow
      href={item.href}
      leading={<MobileIconTile icon={item.icon} />}
      title={item.label}
      subtitle={item.description}
    />
  );
}

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
  const upperRole = role.toUpperCase();
  const effective = useEffectiveCapabilities({ role: isAppRole(upperRole) ? upperRole : 'USER' });
  const authorizedOperations = operations.filter(item => canAccessPath(item.href, effective));

  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1).toLowerCase() : 'User';

  return (
    <div className="responsive-page space-y-5">
      <section className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4">
        <MobileAvatar name={name} src={avatarUrl || undefined} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{name}</h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {email || 'No email on file'}
          </p>
        </div>
        <MobileToneBadge tone={null}>{roleLabel}</MobileToneBadge>
      </section>

      <MobileSection id="more-operations" title="Operations">
        <MobileListCard>
          {authorizedOperations.map(item => (
            <NavigationRow key={item.href} item={item} />
          ))}
        </MobileListCard>
      </MobileSection>

      <MobileSection id="more-device" title="App & device">
        <div className="space-y-2">
          <PwaInstallCard />
          <MobileThemeToggle />
          <MobileBiometricToggle />
          <PushNotificationToggle />
        </div>
      </MobileSection>

      <MobileSection id="more-account" title="Account & help">
        <MobileListCard>
          {account.map(item => (
            <NavigationRow key={item.href} item={item} />
          ))}
          <li>
            <MobileSignOutButton
              icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
              label="Sign out"
              description="Sign out of OpsKnight on this device"
              tone="red"
            />
          </li>
        </MobileListCard>
      </MobileSection>

      <p className="pb-1 text-center text-xs tabular-nums text-muted-foreground">
        OpsKnight {APP_VERSION}
      </p>
    </div>
  );
}
