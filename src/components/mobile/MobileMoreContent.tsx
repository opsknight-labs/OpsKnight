'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ChevronRight,
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
import { Card } from '@/components/ui/shadcn/card';
import { APP_VERSION } from '@/lib/constants';

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
  { href: '/m/users', label: 'Users', description: 'Directory and roles', icon: Users },
];

const account: NavigationItem[] = [
  {
    href: '/settings/profile',
    label: 'Profile & security',
    description: 'Account, devices and sessions',
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
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 text-card-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden={true} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">
          {item.label}
        </span>
        {item.description && (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {item.description}
          </span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
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

  return (
    <div className="responsive-page space-y-5">
      <section className="flex min-w-0 items-center gap-3 px-0.5 py-1">
        <div className="shrink-0">
          <MobileAvatar name={name} src={avatarUrl || undefined} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold text-foreground">{name}</h1>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {email || 'No email on file'}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          {role}
        </span>
      </section>

      <Section title="Operations">
        <Card className="divide-y divide-border/70 overflow-hidden rounded-xl border-border bg-card shadow-none">
          {operations.map(item => (
            <NavigationRow key={item.href} item={item} />
          ))}
        </Card>
      </Section>

      <Section title="App & device">
        <div className="space-y-2">
          <PwaInstallCard />
          <MobileThemeToggle />
          <MobileBiometricToggle />
          <PushNotificationToggle />
        </div>
      </Section>

      <Section title="Account & help">
        <Card className="divide-y divide-border/70 overflow-hidden rounded-xl border-border bg-card shadow-none">
          {account.map(item => (
            <NavigationRow key={item.href} item={item} />
          ))}
          <MobileSignOutButton
            icon={<LogOut className="h-[18px] w-[18px]" aria-hidden="true" />}
            label="Sign out"
            description="Sign out of OpsKnight on this device"
            tone="red"
          />
        </Card>
      </Section>

      <p className="pb-1 text-center text-[10px] text-muted-foreground">OpsKnight {APP_VERSION}</p>
    </div>
  );
}
