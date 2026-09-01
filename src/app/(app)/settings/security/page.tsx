import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import SecurityForm from '@/components/settings/SecurityForm';
import ActiveSessionsSection from '@/components/settings/ActiveSessionsSection';
import SecurityRecentActivity, {
  type SecurityAuditItem,
} from '@/components/settings/SecurityRecentActivity';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import Link from 'next/link';
import { ShieldCheck, KeyRound, Fingerprint, ExternalLink, Laptop } from 'lucide-react';

export default async function SecuritySettingsPage() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;

  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          role: true,
          tokenVersion: true,
          passwordHash: true,
          lastOidcSync: true,
          createdAt: true,
          updatedAt: true,
          oidcIdentities: {
            select: {
              issuer: true,
              email: true,
              createdAt: true,
            },
          },
        },
      })
    : null;

  const hasPassword = Boolean(user?.passwordHash);
  const isSsoLinked = Boolean(
    user?.lastOidcSync || (user?.oidcIdentities && user.oidcIdentities.length > 0)
  );
  const isAdmin = user?.role === 'ADMIN';

  // Fetch recent user-specific audit logs
  let recentAuditLogs: SecurityAuditItem[] = [];
  if (user?.id) {
    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          OR: [{ actorId: user.id }, { entityId: user.id }],
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          createdAt: true,
          details: true,
        },
      });

      recentAuditLogs = logs.map(l => ({
        id: l.id,
        action: l.action,
        timestamp: l.createdAt.toISOString(),
        details:
          typeof l.details === 'object' && l.details !== null
            ? (l.details as Record<string, unknown>)
            : null,
      }));
    } catch {
      recentAuditLogs = [];
    }
  }

  // Format issuer for clean presentation (e.g., https://accounts.google.com -> Google)
  const formatIssuerName = (issuerUrl: string) => {
    try {
      const url = new URL(issuerUrl);
      if (url.hostname.includes('google')) return 'Google SSO';
      if (url.hostname.includes('okta')) return 'Okta';
      if (url.hostname.includes('microsoft') || url.hostname.includes('azure'))
        return 'Microsoft Entra ID';
      if (url.hostname.includes('github')) return 'GitHub';
      return url.hostname;
    } catch {
      return issuerUrl;
    }
  };

  return (
    <div className="space-y-6">
      {/* Centralized Glassmorphic Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Security',
        }}
        tag="Identity & Protection"
        title="Security & Authentication"
        subtitle="Control how you sign in, manage cryptographic credentials, and monitor active sessions across all devices."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <ShieldCheck className="h-8 w-8" />
          </div>
        }
        badges={
          <>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
            >
              Active & Guarded
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs"
            >
              {isSsoLinked ? 'SSO Federated' : 'Direct Password'}
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs"
            >
              Role: {user?.role || 'USER'}
            </Badge>
          </>
        }
        stats={[
          {
            label: 'Token Version',
            value: `v${user?.tokenVersion ?? 1}`,
            icon: <KeyRound className="h-3.5 w-3.5" />,
            subtext: 'Session state',
          },
          {
            label: 'Active Sessions',
            value: '1 Device',
            icon: <Laptop className="h-3.5 w-3.5" />,
            subtext: 'Current browser',
          },
          {
            label: 'Auth Method',
            value: isSsoLinked ? 'SSO Link' : 'Password',
            icon: <Fingerprint className="h-3.5 w-3.5" />,
            subtext: isSsoLinked ? 'OIDC Active' : 'Direct login',
          },
          {
            label: 'Protection',
            value: hasPassword ? 'Secured' : 'SSO Only',
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext: 'Credentials valid',
          },
        ]}
      />

      {/* Section 1: Password & Credentials */}
      <SettingsSection
        title="Password & Credentials"
        description="Update your account password. Modifying your credentials will automatically terminate all other active sessions for your protection."
        footer={
          <p className="text-xs text-muted-foreground">
            Passwords must contain at least 8 characters including uppercase, lowercase, numbers,
            and symbols.
          </p>
        }
      >
        <SecurityForm hasPassword={hasPassword} />
      </SettingsSection>

      {/* Section 2: Active Sessions & Devices */}
      <SettingsSection
        title="Active Sessions"
        description="Manage connected browsers and devices with active cryptographic access to your account."
        footer={
          <p className="text-xs text-muted-foreground">
            Revoking all sessions increments your identity token version and signs you out from
            every browser immediately.
          </p>
        }
      >
        <ActiveSessionsSection tokenVersion={user?.tokenVersion ?? 1} />
      </SettingsSection>

      {/* Section 3: Identity & Single Sign-On */}
      <SettingsSection
        title="Single Sign-On (SSO)"
        description="Enterprise identity federation and third-party login providers."
        footer={
          isAdmin ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                As an administrator, you can configure workspace-wide OIDC / SAML providers in
                System Settings.
              </p>
              <Button variant="ghost" size="sm" asChild className="gap-1 text-xs h-8">
                <Link href="/settings/system">
                  Configure Workspace SSO
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Single Sign-On configuration is centrally managed by your workspace administrators.
            </p>
          )
        }
      >
        <div className="divide-y text-sm">
          <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="font-medium text-foreground text-sm">Authentication Mode</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isSsoLinked
                  ? 'Your account is linked to enterprise identity providers (OIDC / OAuth).'
                  : 'You sign in directly using email and password.'}
              </p>
            </div>
            <div>
              {isSsoLinked ? (
                <Badge
                  variant="outline"
                  className="bg-primary/10 text-primary border-primary/20 text-xs"
                >
                  SSO Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Direct Auth
                </Badge>
              )}
            </div>
          </div>

          {user?.lastOidcSync && (
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-medium text-foreground text-sm">Last Identity Provider Sync</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Synchronized profile claims and authorization tokens
                </p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(user.lastOidcSync).toLocaleString()}
              </span>
            </div>
          )}

          {user?.oidcIdentities && user.oidcIdentities.length > 0 && (
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-medium text-foreground text-sm">Linked Providers</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Third-party authentication connections
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {user.oidcIdentities.map((identity, idx) => (
                  <Badge key={idx} variant="secondary" className="capitalize text-xs">
                    {formatIssuerName(identity.issuer)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Section 4: Recent Security Activity */}
      <SettingsSection
        title="Recent Security Activity"
        description="Audit history of authentication and credential events on your account."
        footer={
          <p className="text-xs text-muted-foreground">
            All security events are immutable and archived in the OpsKnight compliance audit trail.
          </p>
        }
      >
        <SecurityRecentActivity events={recentAuditLogs} userEmail={email} />
      </SettingsSection>
    </div>
  );
}
