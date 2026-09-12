import { getUserPermissions } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';
import AppUrlSettings from '@/components/settings/AppUrlSettings';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import SsoSettingsForm from '@/components/settings/SsoSettingsForm';
import RetentionPolicySettings from '@/components/settings/RetentionPolicySettings';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import SystemSettingsTabs from '@/components/settings/SystemSettingsTabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';

import {
  Shield,
  AlertTriangle,
  Globe,
  Lock,
  Database,
  Key,
  CheckCircle2,
  XCircle,
  Layers,
} from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Server-side env var presence check — no secrets ever exposed */
function detectEnvStatus() {
  const nextPublicAppUrl = Boolean(process.env.NEXT_PUBLIC_APP_URL);
  const nextAuthUrl = Boolean(process.env.NEXTAUTH_URL);
  return {
    encryptionKey: Boolean(process.env.ENCRYPTION_KEYS || process.env.ENCRYPTION_KEY),
    encryptionKeysConfigured: Boolean(process.env.ENCRYPTION_KEYS),
    appUrl: nextPublicAppUrl || nextAuthUrl,
    nextPublicAppUrl,
    nextAuthUrl,
    databaseUrl: Boolean(process.env.DATABASE_URL),
    nextAuthSecret: Boolean(process.env.NEXTAUTH_SECRET),
  };
}

export default async function SystemSettingsPage() {
  try {
    const permissions = await getUserPermissions();

    if (!permissions.isAdmin) {
      return (
        <div className="space-y-6">
          <DetailHeroBanner
            breadcrumb={{ label: 'Settings', href: '/settings', current: 'System' }}
            tag="SYSTEM ADMINISTRATION"
            title="System Settings"
            subtitle="Application-wide configuration and defaults."
          />
          <Alert variant="destructive">
            <Shield className="h-4 w-4" />
            <AlertTitle>Admin Role Required</AlertTitle>
            <AlertDescription>
              Your current role is <strong>{permissions.role}</strong>. Contact an administrator for
              access to system settings.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    const prisma = (await import('@/lib/prisma')).default;

    const [systemSettings, rawOidcConfig] = await Promise.all([
      prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { appUrl: true, updatedAt: true },
      }),
      prisma.oidcConfig.findFirst({ orderBy: { updatedAt: 'desc' } }),
    ]);

    const appUrl = systemSettings?.appUrl ?? null;
    const appUrlFallback =
      process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const authOrigin = resolveAuthPublicOrigin({ dbAppUrl: appUrl });
    const ssoCallbackUrl = authOrigin.callbackUrl;

    let oidcConfig: {
      enabled: boolean;
      issuer: string | null;
      clientId: string | null;
      autoProvision: boolean;
      allowedDomains: string[];
      hasClientSecret: boolean;
      roleMapping?: unknown;
      customScopes?: string | null;
      providerType?: string | null;
      providerLabel?: string | null;
      organizationId?: string | null;
      tokenEndpointAuthMethod?: string | null;
      profileMapping?: Record<string, string> | null;
      updatedAt: string;
    } | null = null;

    if (rawOidcConfig) {
      oidcConfig = {
        enabled: rawOidcConfig.enabled,
        issuer: rawOidcConfig.issuer,
        clientId: rawOidcConfig.clientId,
        autoProvision: rawOidcConfig.autoProvision,
        allowedDomains: rawOidcConfig.allowedDomains,
        hasClientSecret: !!rawOidcConfig.clientSecret,
        roleMapping: rawOidcConfig.roleMapping,
        customScopes: rawOidcConfig.customScopes,
        providerType: rawOidcConfig.providerType,
        providerLabel: rawOidcConfig.providerLabel,
        organizationId: rawOidcConfig.organizationId,
        tokenEndpointAuthMethod: rawOidcConfig.tokenEndpointAuthMethod,
        profileMapping: rawOidcConfig.profileMapping as Record<string, string> | null,
        updatedAt: rawOidcConfig.updatedAt.toISOString(),
      };
    }

    const env = detectEnvStatus();
    const isAppUrlConfigured = Boolean(appUrl || env.appUrl);
    const ssoEnabled = Boolean(oidcConfig?.enabled);
    const appUrlConfigured = Boolean(appUrl);
    const effectiveEnv = {
      encryptionKey: env.encryptionKey,
      appUrl: isAppUrlConfigured,
      databaseUrl: env.databaseUrl,
      nextAuthSecret: env.nextAuthSecret,
    };
    const allEnvOk = Object.values(effectiveEnv).every(Boolean);
    const missingCount = Object.values(effectiveEnv).filter(v => !v).length;

    const appUrlTab = (
      <SettingsSection
        title="Application URL"
        description="The publicly reachable base URL — used in emails, webhooks, RSS feeds, and status page links."
        action={
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-blue-500/10">
              <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <Badge variant={appUrlConfigured ? 'success' : 'neutral'} className="text-xs">
              {appUrlConfigured ? 'Custom' : 'Fallback'}
            </Badge>
          </div>
        }
      >
        <AppUrlSettings
          appUrl={appUrl}
          fallback={appUrlFallback}
          updatedAt={systemSettings?.updatedAt?.toISOString() ?? null}
        />
      </SettingsSection>
    );

    const ssoTab = (
      <SsoSettingsForm
        initialConfig={oidcConfig}
        callbackUrl={ssoCallbackUrl}
        hasEncryptionKey={env.encryptionKey}
      />
    );

    const retentionTab = <RetentionPolicySettings />;

    const envRows = [
      {
        key: 'ENCRYPTION_KEY',
        ok: env.encryptionKey,
        icon: <Lock className="h-4 w-4" />,
        scope: 'Server Secret',
        source: env.encryptionKey ? 'Environment (.env)' : 'Not Set',
        statusBadgeText: env.encryptionKey ? 'Configured' : 'Missing',
        note: 'Required to encrypt SSO client secrets and integration credentials at rest',
        impact: 'SSO & Integrations',
        required: true,
      },
      {
        key: 'APP URL FALLBACK',
        ok: isAppUrlConfigured,
        icon: <Globe className="h-4 w-4" />,
        scope: 'Public URL',
        source: appUrl
          ? 'UI Console (Database)'
          : env.nextPublicAppUrl
            ? 'NEXT_PUBLIC_APP_URL'
            : env.nextAuthUrl
              ? 'NEXTAUTH_URL'
              : 'localhost fallback',
        statusBadgeText: appUrl
          ? 'Configured (UI)'
          : env.nextPublicAppUrl
            ? 'NEXT_PUBLIC_APP_URL'
            : env.nextAuthUrl
              ? 'NEXTAUTH_URL'
              : 'Fallback',
        note: appUrl
          ? `Database setting is authoritative for application-generated links (${appUrl}). OIDC callback registration uses canonical auth origin ${authOrigin.origin} from ${authOrigin.source}.`
          : `Application links use environment fallback. OIDC callback registration uses canonical auth origin ${authOrigin.origin} from ${authOrigin.source}.`,
        impact: 'Notifications & Webhooks',
        required: false,
        actionHref: '/settings/system?section=app-url',
        actionLabel: appUrl ? 'Edit in App URL tab →' : 'Configure in UI →',
      },
      {
        key: 'DATABASE_URL',
        ok: env.databaseUrl,
        icon: <Database className="h-4 w-4" />,
        scope: 'Server Secret',
        source: env.databaseUrl ? 'Environment (.env)' : 'Not Set',
        statusBadgeText: env.databaseUrl ? 'Configured' : 'Missing',
        note: 'Primary PostgreSQL connection string with pooling and migration access',
        impact: 'Core Persistence',
        required: true,
      },
      {
        key: 'NEXTAUTH_SECRET',
        ok: env.nextAuthSecret,
        icon: <Key className="h-4 w-4" />,
        scope: 'Server Secret',
        source: env.nextAuthSecret ? 'Environment (.env)' : 'Auto-generated fallback',
        statusBadgeText: env.nextAuthSecret ? 'Configured' : 'Missing',
        note: 'Cryptographic key used to sign and verify user authentication session cookies',
        impact: 'Authentication',
        required: true,
      },
    ];

    const envTab = (
      <SettingsSection
        title="Environment Variables"
        description="Server-side configuration checks. Secret values are never sent to or readable in the browser."
        action={
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-md ${allEnvOk ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}
            >
              <Layers
                className={`h-4 w-4 ${allEnvOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
              />
            </div>
            <Badge variant={allEnvOk ? 'success' : 'destructive'} className="text-xs shrink-0">
              {allEnvOk ? 'All Set' : `${missingCount} Missing`}
            </Badge>
          </div>
        }
        footer={
          !allEnvOk ? (
            <p className="text-xs text-muted-foreground">
              Set missing variables in your deployment environment (
              <code className="font-mono text-foreground font-semibold">.env.local</code> for local
              development,{' '}
              <code className="font-mono text-foreground font-semibold">docker-compose.yml</code> or
              your container orchestrator for production), then restart the application.
            </p>
          ) : undefined
        }
      >
        <div className="py-4 space-y-4">
          <div
            className={`rounded-lg border px-4 py-3 text-xs flex items-center gap-2.5 ${
              allEnvOk
                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-500/5 border-rose-500/20 text-rose-800 dark:text-rose-300'
            }`}
          >
            {allEnvOk ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            )}
            <span>
              {allEnvOk
                ? 'All critical environment variables and console overrides are active in the current runtime.'
                : `${missingCount} required configuration${missingCount > 1 ? 's are' : ' is'} missing. Related system functions will be limited.`}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {envRows.map(row => (
              <div
                key={row.key}
                className={`relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-150 hover:shadow-sm ${
                  row.ok
                    ? 'border-border/80 bg-card hover:border-emerald-500/40'
                    : 'border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`p-1.5 rounded-md shrink-0 ${
                          row.ok
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {row.icon}
                      </div>
                      <code className="text-xs font-mono font-bold tracking-tight text-foreground truncate">
                        {row.key}
                      </code>
                    </div>
                    <Badge
                      variant={row.ok ? 'success' : 'destructive'}
                      className="text-[10px] shrink-0 font-medium"
                    >
                      {row.ok ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {row.statusBadgeText}
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3 mr-1" />
                          {row.statusBadgeText}
                        </>
                      )}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">{row.note}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground/80">
                      {row.scope}
                    </span>
                    <span className="text-[10px] rounded bg-muted/60 px-1.5 py-0.5 border border-border/50 text-muted-foreground font-medium">
                      {row.source}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {row.actionHref && (
                      <Link
                        href={row.actionHref}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        {row.actionLabel}
                      </Link>
                    )}
                    <Badge
                      variant="outline"
                      className="text-[10px] font-normal text-muted-foreground border-border/70"
                    >
                      {row.impact}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>
    );

    const encryptionBadge = env.encryptionKey ? (
      <Badge
        variant="outline"
        className="border-emerald-400/60 bg-emerald-400/15 text-emerald-100 text-[10px] font-semibold"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Encryption Key Set
      </Badge>
    ) : (
      <Badge
        variant="outline"
        className="border-rose-400/60 bg-rose-400/15 text-rose-100 text-[10px] font-semibold"
      >
        <XCircle className="h-3 w-3 mr-1" />
        Encryption Key Missing
      </Badge>
    );

    return (
      <div className="space-y-6">
        <DetailHeroBanner
          breadcrumb={{ label: 'Settings', href: '/settings', current: 'System' }}
          tag="SYSTEM ADMINISTRATION"
          title="System Settings"
          subtitle="Core application configuration — App URL, SSO, data retention, and environment."
          badges={
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground text-[10px] font-semibold"
              >
                <Shield className="h-3 w-3 mr-1" />
                Admin Only
              </Badge>
              {encryptionBadge}
            </div>
          }
          statsPlacement="bottom"
          stats={[
            {
              label: 'App URL',
              value: appUrlConfigured ? 'Custom' : 'Fallback',
              icon: <Globe className="h-4 w-4" />,
              valueClassName: appUrlConfigured ? 'text-emerald-300' : 'text-amber-300',
              subtext: appUrlConfigured ? appUrl! : appUrlFallback,
            },
            {
              label: 'SSO / OIDC',
              value: ssoEnabled ? 'Enabled' : 'Disabled',
              icon: <Shield className="h-4 w-4" />,
              valueClassName: ssoEnabled ? 'text-emerald-300' : 'text-primary-foreground/70',
              subtext: ssoEnabled ? String(oidcConfig?.providerType ?? 'oidc') : 'Not configured',
            },
            {
              label: 'Data Retention',
              value: 'Active',
              icon: <Database className="h-4 w-4" />,
              valueClassName: 'text-emerald-300',
              subtext: '5 retention policies active',
            },
            {
              label: 'Environment',
              value: allEnvOk ? 'All Set' : `${missingCount} Missing`,
              icon: <Key className="h-4 w-4" />,
              valueClassName: allEnvOk ? 'text-emerald-300' : 'text-rose-300',
              subtext: `${4 - missingCount}/4 configurations active`,
            },
          ]}
        />

        {authOrigin.conflicts.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Authentication origin mismatch</AlertTitle>
            <AlertDescription>
              OIDC uses <strong>{authOrigin.origin}</strong> from {authOrigin.source}. Other
              configured public origins differ. Register <strong>{authOrigin.callbackUrl}</strong>{' '}
              at the identity provider and align the conflicting URL settings to avoid
              proxy/callback confusion.
            </AlertDescription>
          </Alert>
        )}

        {!env.encryptionKey && process.env.NODE_ENV !== 'development' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Encryption Key Missing</AlertTitle>
            <AlertDescription>
              Neither <strong>ENCRYPTION_KEYS</strong> nor <strong>ENCRYPTION_KEY</strong> is set in
              the environment. SSO secrets and integration credentials cannot be stored securely.
            </AlertDescription>
          </Alert>
        )}

        <SystemSettingsTabs
          appUrlTab={appUrlTab}
          ssoTab={ssoTab}
          retentionTab={retentionTab}
          envTab={envTab}
          ssoEnabled={ssoEnabled}
          appUrlConfigured={appUrlConfigured}
          allEnvOk={allEnvOk}
          missingCount={missingCount}
        />
      </div>
    );
  } catch (error) {
    logger.error('[SystemSettings] Critical rendering error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return (
      <div className="p-6 space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>System Configuration Error</AlertTitle>
          <AlertDescription>
            The system encountered an error while loading settings. This might be due to a database
            connection issue or an encryption key problem.
            <pre className="mt-2 text-xs bg-black/10 p-2 rounded overflow-auto">
              {error instanceof Error ? error.message : 'Unknown error'}
            </pre>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}
