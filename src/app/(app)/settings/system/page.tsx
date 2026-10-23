import AuthenticationSettingsLoader from '@/components/settings/AuthenticationSettingsLoader';
import AutomationSettings from '@/components/settings/AutomationSettings';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { getAutomationSettings } from '@/lib/automation/settings';
import { getUserPermissions } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';
import AppUrlSettings from '@/components/settings/AppUrlSettings';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import RetentionPolicySettings from '@/components/settings/RetentionPolicySettings';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import SystemSettingsTabs from '@/components/settings/SystemSettingsTabs';
import SystemOverviewTab from '@/components/settings/SystemOverviewTab';
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
  Terminal,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import ScimSettingsSection from '@/components/settings/ScimSettingsSection';
import { getScimConfig } from '@/lib/scim';
import ScimIntegrationSummary from '@/components/settings/ScimIntegrationSummary';

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
    apiKeySecret: Boolean(process.env.API_KEY_SECRET),
  };
}

async function loadSystemSettings() {
  const permissions = await getUserPermissions();
  if (!permissions.isAdmin) return { kind: 'forbidden' as const, role: permissions.role };
  const prisma = (await import('@/lib/prisma')).default;
  // Dedicated PostgreSQL ping probe to accurately measure database round-trip latency
  const pingStart = performance.now();
  await prisma.$queryRawUnsafe('SELECT 1');
  const dbPingMs = Math.max(1, Math.round(performance.now() - pingStart));

  const [
    systemSettings,
    rawOidcConfig,
    scimConfig,
    effectivePolicy,
    automationSettings,
    incidentCount,
    serviceCount,
    userCount,
    integrationCount,
    automationCount,
    runbookCount,
  ] = await Promise.all([
    prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: { appUrl: true, updatedAt: true },
    }),
    prisma.oidcConfig.findUnique({
      where: { id: 'default' },
      select: { enabled: true, providerType: true },
    }),
    getScimConfig(),
    getAuthenticationPolicy(),
    getAutomationSettings(),
    prisma.incident.count(),
    prisma.service.count(),
    prisma.user.count(),
    prisma.integration.count(),
    prisma.serviceAutomationRule.count(),
    prisma.runbook.count(),
  ]);
  const memory = process.memoryUsage();
  const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
  const heapTotalMb = Math.round(memory.heapTotal / 1024 / 1024);
  const uptimeSeconds = Math.floor(process.uptime());
  const nodeVersion = process.version;
  const platform = process.platform;
  const processId = process.pid;

  return {
    kind: 'ok' as const,
    systemSettings,
    rawOidcConfig,
    scimConfig,
    effectivePolicy,
    automationSettings,
    metrics: {
      incidentCount,
      serviceCount,
      userCount,
      integrationCount,
      automationCount,
      runbookCount,
      dbLatencyMs: dbPingMs,
      dbPingMs,
      uptimeSeconds,
      heapUsedMb,
      heapTotalMb,
      nodeVersion,
      platform,
      processId,
    },
  };
}

export default async function SystemSettingsPage() {
  // Data loading is isolated from rendering: a try/catch cannot catch render errors, and the
  // failure path must never echo internal error details to the browser.
  let loaded: Awaited<ReturnType<typeof loadSystemSettings>> | null = null;
  try {
    loaded = await loadSystemSettings();
  } catch (error) {
    logger.error('[SystemSettings] Failed to load system settings', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
  if (!loaded) {
    return (
      <div className="p-6 space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>System settings are unavailable</AlertTitle>
          <AlertDescription>
            The settings could not be loaded. This is usually a database connectivity or encryption
            key problem. Details are recorded in the system logs.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (loaded.kind === 'forbidden') {
    return (
      <div className="space-y-6">
        <DetailHeroBanner
          tag="SYSTEM ADMINISTRATION"
          title="System Settings"
          subtitle="Application-wide configuration and defaults."
        />
        <Alert variant="destructive">
          <Shield className="h-4 w-4" />
          <AlertTitle>Admin Role Required</AlertTitle>
          <AlertDescription>
            Your current role is <strong>{loaded.role}</strong>. Contact an administrator for access
            to system settings.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { systemSettings, rawOidcConfig, scimConfig, effectivePolicy, automationSettings } = loaded;

  const appUrl = systemSettings?.appUrl ?? null;
  const appUrlFallback =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const authOrigin = resolveAuthPublicOrigin({ dbAppUrl: appUrl });
  const ssoCallbackUrl = authOrigin.callbackUrl;
  const scimTenantUrl = `${authOrigin.origin}/api/scim/v2`;

  const env = detectEnvStatus();
  const isAppUrlConfigured = Boolean(appUrl || env.appUrl);
  const ssoEnabled = Boolean(rawOidcConfig?.enabled) && effectivePolicy.mode !== 'PASSWORD_ONLY';
  const appUrlConfigured = Boolean(appUrl);
  const effectiveEnv = {
    encryptionKey: env.encryptionKey,
    appUrl: isAppUrlConfigured,
    databaseUrl: env.databaseUrl,
    nextAuthSecret: env.nextAuthSecret,
    apiKeySecret: env.apiKeySecret,
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
    <AuthenticationSettingsLoader
      callbackUrl={ssoCallbackUrl}
      testCallbackUrl={`${authOrigin.origin}/api/auth/oidc/test/callback`}
      scimSection={<ScimIntegrationSummary {...scimConfig} tenantUrl={scimTenantUrl} />}
    />
  );

  const scimTab = (
    <SettingsSection
      title="SCIM 2.0 User Provisioning"
      description="Automate identity lifecycle, profile provisioning, and account deactivation directly from Okta, Entra ID, or any SCIM 2.0 compliant identity provider."
      action={
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-md ${scimConfig.enabled && scimConfig.hasSecretToken ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}
          >
            <UserCheck className="h-4 w-4" />
          </div>
          <Badge
            variant={scimConfig.enabled && scimConfig.hasSecretToken ? 'success' : 'neutral'}
            className="text-xs"
          >
            {scimConfig.enabled && scimConfig.hasSecretToken ? 'Active' : 'Not Configured'}
          </Badge>
        </div>
      }
    >
      <ScimSettingsSection
        key="scim-settings-dedicated"
        initialConfig={scimConfig}
        tenantUrl={scimTenantUrl}
      />
    </SettingsSection>
  );

  const retentionTab = <RetentionPolicySettings />;
  const automationTab = <AutomationSettings initialSettings={automationSettings} />;

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
    {
      key: 'API_KEY_SECRET',
      ok: env.apiKeySecret,
      icon: <Key className="h-4 w-4" />,
      scope: 'Server Secret',
      source: env.apiKeySecret ? 'Environment (.env)' : 'Not Set',
      statusBadgeText: env.apiKeySecret ? 'Configured' : 'Missing',
      note: 'Independent signing secret used to generate and verify Public REST API keys',
      impact: 'Public REST API',
      required: true,
    },
  ];

  const envTab = (
    <SettingsSection
      title="Environment Variables"
      description="Server-side configuration checks. Secret values are never sent to or readable in the browser."
      action={
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-md ${allEnvOk ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
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

  const overviewTab = (
    <SystemOverviewTab
      metrics={loaded.metrics}
      subsystems={{
        appUrl,
        appUrlConfigured,
        ssoEnabled,
        ssoProviderType: rawOidcConfig?.providerType ?? null,
        scimEnabled: Boolean(scimConfig.enabled && scimConfig.hasSecretToken),
        allEnvOk,
        missingCount,
        encryptionKeySet: env.encryptionKey,
        authOrigin: { origin: authOrigin.origin, source: authOrigin.source },
      }}
    />
  );

  return (
    <div className="space-y-6">
      <DetailHeroBanner
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
        actions={
          <Link
            href="/system-logs"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground text-xs font-semibold transition-colors"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>View System Logs</span>
          </Link>
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
            subtext: ssoEnabled ? String(rawOidcConfig?.providerType ?? 'oidc') : 'Not configured',
          },
          {
            label: 'SCIM 2.0',
            value: scimConfig.enabled && scimConfig.hasSecretToken ? 'Active' : 'Disabled',
            icon: <UserCheck className="h-4 w-4" />,
            valueClassName:
              scimConfig.enabled && scimConfig.hasSecretToken
                ? 'text-emerald-300'
                : 'text-primary-foreground/70',
            subtext:
              scimConfig.enabled && scimConfig.hasSecretToken
                ? 'Lifecycle provisioning ready'
                : 'Not configured',
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
            subtext: `${5 - missingCount}/5 configurations active`,
          },
        ]}
      />

      {authOrigin.conflicts.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Authentication origin mismatch</AlertTitle>
          <AlertDescription>
            OIDC uses <strong>{authOrigin.origin}</strong> from {authOrigin.source}. Other
            configured public origins differ. Register <strong>{authOrigin.callbackUrl}</strong> at
            the identity provider and align the conflicting URL settings to avoid proxy/callback
            confusion.
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
        overviewTab={overviewTab}
        automationTab={automationTab}
        appUrlTab={appUrlTab}
        ssoTab={ssoTab}
        scimTab={scimTab}
        retentionTab={retentionTab}
        envTab={envTab}
        ssoEnabled={ssoEnabled}
        scimEnabled={scimConfig.enabled && scimConfig.hasSecretToken}
        appUrlConfigured={appUrlConfigured}
        allEnvOk={allEnvOk}
        missingCount={missingCount}
      />
    </div>
  );
}
