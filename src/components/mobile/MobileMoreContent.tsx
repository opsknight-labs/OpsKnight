'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronRight,
  FileText,
  LogOut,
  Monitor,
  Settings,
  ShieldCheck,
  Signal,
  Users,
  UsersRound,
} from 'lucide-react';
import MobileThemeToggle from '@/components/mobile/MobileThemeToggle';
import PushNotificationToggle from '@/components/mobile/PushNotificationToggle';
import MobileBiometricToggle from '@/components/mobile/MobileBiometricToggle';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { useUserAvatarContextSafe } from '@/contexts/UserAvatarContext';
import PwaInstallCard from '@/components/mobile/PwaInstallCard';
import MobileSignOutButton from '@/components/mobile/MobileSignOutButton';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { APP_VERSION } from '@/lib/constants';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

type NavigationItem = {
  href: string;
  label: string;
  description: string;
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

const shortcuts: NavigationItem[] = [
  { href: '/m/teams', label: 'Teams', description: 'Ownership and responders', icon: UsersRound },
  { href: '/m/users', label: 'Users', description: 'Directory and roles', icon: Users },
  { href: '/m/schedules', label: 'Schedules', description: 'On-call rotations', icon: CalendarDays },
  { href: '/m/policies', label: 'Policies', description: 'Escalation paths', icon: ShieldCheck },
];

const resources: NavigationItem[] = [
  { href: '/m/analytics', label: 'Analytics', description: 'Incident performance and trends', icon: BarChart3 },
  { href: '/m/postmortems', label: 'Postmortems', description: 'Reviews and follow-up work', icon: FileText },
  { href: '/m/status', label: 'Status', description: 'Operational status pages', icon: Signal },
];

const account: NavigationItem[] = [
  { href: '/settings/profile', label: 'Settings', description: 'Profile, security and preferences', icon: Settings },
  { href: '/m/help', label: 'Help & Documentation', description: 'Guides and responder help', icon: BookOpen },
  { href: '/api/prefer-desktop', label: 'Desktop mode', description: 'Open the full desktop workspace', icon: Monitor },
];

function NavigationRow({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex min-h-14 items-center gap-3 px-4 py-3 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{item.description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
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
    <div className="responsive-page space-y-5 px-3 py-4 sm:px-4">
      <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
        <div className="h-1 bg-gradient-to-r from-primary via-slate-500 to-primary/60" />
        <div className="flex min-w-0 items-center gap-4 p-4 sm:p-5">
          <div className="shrink-0 rounded-full ring-2 ring-border ring-offset-2 ring-offset-background">
            <MobileAvatar name={name} src={avatarUrl || undefined} size="xl" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight text-foreground">{name}</h1>
            <p className="truncate text-sm text-muted-foreground">{email || 'No email on file'}</p>
            <span className="mt-2 inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {role}
            </span>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 rounded-xl">
            <Link href="/m/notifications">Alerts</Link>
          </Button>
        </div>
      </Card>

      <Section title="Workspace">
        <div className="grid grid-cols-2 gap-2.5">
          {shortcuts.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group min-w-0 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm transition hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
              >
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.description}</span>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section title="Operations">
        <Card className="divide-y divide-border overflow-hidden rounded-2xl border-border shadow-sm">
          {resources.map(item => <NavigationRow key={item.href} item={item} />)}
        </Card>
      </Section>

      <Section title="Device & preferences">
        <div className="space-y-2.5">
          <PwaInstallCard />
          <MobileThemeToggle />
          <MobileBiometricToggle />
          <PushNotificationToggle />
        </div>
      </Section>

      <Section title="Account">
        <Card className="divide-y divide-border overflow-hidden rounded-2xl border-border shadow-sm">
          {account.map(item => <NavigationRow key={item.href} item={item} />)}
          <MobileSignOutButton
            icon={<LogOut className="h-4.5 w-4.5" aria-hidden="true" />}
            label="Sign Out"
            description="Sign out of OpsKnight on this device"
            tone="red"
          />
        </Card>
      </Section>

      <p className="pb-2 text-center text-[11px] text-muted-foreground">OpsKnight {APP_VERSION}</p>
    </div>
  );
}
