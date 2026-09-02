import { getUserPermissions } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import AppUrlSettings from '@/components/settings/AppUrlSettings';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import SsoSettingsForm from '@/components/settings/SsoSettingsForm';
import RetentionPolicySettings from '@/components/settings/RetentionPolicySettings';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import SystemSettingsTabs from '@/components/settings/SystemSettingsTabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';

import {
  Shield,
  AlertTriangle,
  Globe,
  Lock,
  Database,
  Key,
  HeartPulse,
  CheckCircle2,
  XCircle,
  Layers,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

// Force dynamic rendering to always fetch fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Server-side env var presence check — no secrets ever exposed */
function detectEnvStatus() {
  return {
    encryptionKey: Boolean(process.env.ENCRYPTION_KEY),
    appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
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

    // ----------- Data fetching -----------
    const prisma = (await import('@/lib/prisma')).default;

    const [systemSettings, rawOidcConfig] = await Promise.all([
      prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { appUrl: true },
      }),
      prisma.oidcConfig.findFirst({ orderBy: { updatedAt: 'desc' } }),
    ]);

    const appUrl = systemSettings?.appUrl ?? null;
    const appUrlFallback = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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
      profileMapping?: Record<string, string> | null;
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
        profileMapping: rawOidcConfig.profileMapping as Record<string, string> | null,
      };
    }

    const env = detectEnvStatus();
    const ssoEnabled = Boolean(oidcConfig?.enabled);
    const appUrlConfigured = Boolean(appUrl);
    const allEnvOk = Object.values(env).every(Boolean);
    const missingCount = Object.values(env).filter(v => !v).length;

    // ─────────────────────────────────────────────
    // TAB PANELS  — all use SettingsSection for a consistent header
    // ─────────────────────────────────────────────

    /** App URL */
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
        <AppUrlSettings appUrl={appUrl} fallback={appUrlFallback} />
      </SettingsSection>
    );

    /** SSO */
    const ssoTab = (
      <SsoSettingsForm
        initialConfig={oidcConfig}
        callbackUrl={`${appUrl || appUrlFallback}/api/auth/callback/oidc`}
        hasEncryptionKey={env.encryptionKey}
      />
    );

    /** Data Retention */
    const retentionTab = <RetentionPolicySettings />;

    /** Environment Status */
    const envRows = [
      {
        key: 'ENCRYPTION_KEY',
        ok: env.encryptionKey,
        icon: <Lock className="h-4 w-4" />,
        scope: 'Server Secret',
        note: 'Required to encrypt SSO client secrets and integration credentials at rest',
        impact: 'SSO & Integrations',
        required: true,
      },
      {
        key: 'NEXT_PUBLIC_APP_URL',
        ok: env.appUrl,
        icon: <Globe className="h-4 w-4" />,
        scope: 'Public URL',
        note: 'Public base address used in email alerts, webhook payloads, and RSS feeds',
        impact: 'Notifications & Webhooks',
        required: false,
      },
      {
        key: 'DATABASE_URL',
        ok: env.databaseUrl,
        icon: <Database className="h-4 w-4" />,
        scope: 'Server Secret',
        note: 'Primary PostgreSQL connection string with pooling and migration access',
        impact: 'Core Persistence',
        required: true,
      },
      {
        key: 'NEXTAUTH_SECRET',
        ok: env.nextAuthSecret,
        icon: <Key className="h-4 w-4" />,
        scope: 'Server Secret',
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
          {/* Quick summary notice */}
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
                ? 'All 4 critical environment variables are detected and active in the current runtime.'
                : `${missingCount} required environment variable${missingCount > 1 ? 's are' : ' is'} missing. Related system functions will be limited.`}
            </span>
          </div>

          {/* Variable grid — 2×2 */}
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
                {/* Header: Icon + Variable name + Status */}
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
                          Configured
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3 mr-1" />
                          Missing
                        </>
                      )}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">{row.note}</p>
                </div>

                {/* Footer metadata */}
                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-mono text-[10px] text-muted-foreground/80">
                    {row.scope}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal text-muted-foreground border-border/70"
                  >
                    {row.impact}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>
    );

    // ----------- Hero badge -----------

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
        {/* ── Hero Banner ── */}
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
              label: 'Environment',
              value: allEnvOk ? 'All Set' : `${missingCount} Missing`,
              icon: <Key className="h-4 w-4" />,
              valueClassName: allEnvOk ? 'text-emerald-300' : 'text-rose-300',
              subtext: `${4 - missingCount}/4 variables detected`,
            },
            {
              label: 'Health Center',
              value: 'Open →',
              icon: <HeartPulse className="h-4 w-4" />,
              href: '/settings/system/health',
            },
          ]}
        />

        {/* ── System Health & Diagnostic Center Banner ── */}
        <div className="group relative overflow-hidden rounded-xl border bg-card/60 p-4 sm:p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-emerald-500/40">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5 min-w-0">
              <div className="shrink-0 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <HeartPulse className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">
                    System Health & Telemetry Center
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  >
                    Live Telemetry
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  Real-time database latency, scheduler heartbeats, background queue status, and
                  query telemetry.
                </p>
              </div>
            </div>
            <Link href="/settings/system/health" className="shrink-0 self-start sm:self-center">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs font-medium hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400"
              >
                <span>Open Health Center</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* ── Encryption key warning (non-dev) ── */}
        {!env.encryptionKey && process.env.NODE_ENV !== 'development' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Encryption Key Missing</AlertTitle>
            <AlertDescription>
              The <strong>ENCRYPTION_KEY</strong> environment variable is not set. SSO secrets and
              integration credentials cannot be stored securely.
            </AlertDescription>
          </Alert>
        )}

        {/* ── DetailTabs ── */}
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
