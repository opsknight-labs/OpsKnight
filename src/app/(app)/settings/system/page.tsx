import { getUserPermissions } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import Link from 'next/link';
import AppUrlSettings from '@/components/settings/AppUrlSettings';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import SsoSettingsForm from '@/components/settings/SsoSettingsForm';
import RetentionPolicySettings from '@/components/settings/RetentionPolicySettings';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import {
  Shield,
  AlertTriangle,
  Globe,
  Key,
  UserCheck,
  Database,
  Activity,
  Info,
  ArrowRight,
} from 'lucide-react';

// Force dynamic rendering to always fetch fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SystemSettingsPage() {
  try {
    const permissions = await getUserPermissions();

    // Show access denied message for non-admins instead of redirecting
    if (!permissions.isAdmin) {
      return (
        <div className="space-y-6 system-settings-empty">
          <SettingsPageHeader
            title="System Settings"
            description="Application-wide configuration and defaults."
            backHref="/settings"
            backLabel="Back to Settings"
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

    // Fetch system settings for app URL
    const appUrlData = {
      appUrl: null as string | null,
      fallback: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    };

    let systemSettings: {
      appUrl: string | null;
    } | null = null;
    let oidcConfig: any = null;

    const prisma = (await import('@/lib/prisma')).default;

    systemSettings = await prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: { appUrl: true },
    });

    const rawOidcConfig = await prisma.oidcConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

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
        profileMapping: rawOidcConfig.profileMapping,
      };
    }

    if (systemSettings) {
      appUrlData.appUrl = systemSettings.appUrl;
    }

    // Encryption key is now sourced from ENCRYPTION_KEY env var only
    const encryptionKeySet = Boolean(process.env.ENCRYPTION_KEY);
    const ssoStatus = oidcConfig?.enabled ? 'Enabled' : 'Disabled';
    const appUrlStatus = appUrlData.appUrl ? 'Custom' : 'Fallback';

    return (
      <div className="space-y-6 system-settings-shell">
        <div className="system-settings-hero">
          <SettingsPageHeader
            title="System Settings"
            description="Configure core application settings that affect system-wide behavior."
            backHref="/settings"
            backLabel="Back to Settings"
          />
        </div>

        {/* Dynamic Warning: Encryption key not configured in production */}
        {!encryptionKeySet && process.env.NODE_ENV !== 'development' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Encryption Key Missing</AlertTitle>
            <AlertDescription>
              The <strong>ENCRYPTION_KEY</strong> environment variable is not set. SSO secrets and
              integration credentials cannot be stored securely. Set this variable in your
              deployment environment.
            </AlertDescription>
          </Alert>
        )}

        {/* System Overview Card */}
        <Card className="border-primary/20 bg-primary/5 system-settings-card">
          <CardHeader>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-2xl">High Impact Configuration</CardTitle>
                <CardDescription className="mt-2 text-base">
                  Set the global foundation for URLs, encryption, and identity so every workspace
                  stays consistent and secure. These settings apply to the entire system.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 system-settings-grid">
              {/* Scope Card */}
              <div className="p-4 rounded-lg border border-border bg-background system-settings-meta-card">
                <div className="space-y-2 system-settings-helper">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Scope</span>
                  </div>
                  <p className="font-semibold">Admin Only</p>
                  <p className="text-sm text-muted-foreground">
                    Changes apply to every project, user, and integration in this workspace.
                  </p>
                </div>
              </div>

              {/* Status Card */}
              <div className="p-4 rounded-lg border border-border bg-background">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Status</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">App URL</span>
                      <Badge
                        variant={appUrlData.appUrl ? 'success' : 'neutral'}
                        className="system-settings-pill"
                      >
                        {appUrlStatus}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">SSO</span>
                      <Badge variant={oidcConfig?.enabled ? 'success' : 'neutral'}>
                        {ssoStatus}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Application URL */}
        <SettingsSection
          title="Application URL"
          description="Used in emails, webhooks, and RSS feeds"
          action={
            <div className="flex gap-2">
              <Badge variant="outline">System-wide</Badge>
              <Badge variant="outline">Notifications</Badge>
            </div>
          }
          footer={
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Why this matters</p>
                <p className="text-sm text-muted-foreground">
                  Used for links in notifications, public status pages, and webhook payloads.
                </p>
              </div>
            </div>
          }
        >
          <AppUrlSettings appUrl={appUrlData.appUrl} fallback={appUrlData.fallback} />
        </SettingsSection>

        {/* Single Sign-On */}
        <SettingsSection
          title="Single Sign-On (OIDC)"
          description="Allow users to log in with your identity provider"
          action={
            <div className="flex gap-2">
              <Badge variant="outline">Authentication</Badge>
              <Badge variant="outline">OIDC</Badge>
            </div>
          }
          footer={
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Common pitfall</p>
                <p className="text-sm text-muted-foreground">
                  Double-check redirect URLs before enabling SSO for all users.
                </p>
              </div>
            </div>
          }
        >
          <SsoSettingsForm
            initialConfig={oidcConfig}
            callbackUrl={`${appUrlData.appUrl || appUrlData.fallback}/api/auth/callback/oidc`}
            hasEncryptionKey={encryptionKeySet}
          />
        </SettingsSection>

        {/* Data Retention */}
        <SettingsSection
          title="Data Retention"
          description="Configure how long to keep historical data"
          action={
            <div className="flex gap-2">
              <Badge variant="outline">Storage</Badge>
              <Badge variant="outline">Performance</Badge>
              <Badge variant="outline">Compliance</Badge>
            </div>
          }
          footer={
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Why this matters</p>
                <p className="text-sm text-muted-foreground">
                  Controls "All Time" queries in Command Center. Longer retention means more
                  complete historical data but slower queries and more storage.
                </p>
              </div>
            </div>
          }
        >
          <RetentionPolicySettings />
        </SettingsSection>

        {/* Performance Monitoring */}
        <SettingsSection
          title="Administrator Health Center"
          description="Review database, migrations, workers, escalations, delivery, backups, and version status"
          action={
            <Link href="/settings/system/health">
              <Button variant="outline">
                Open Health Center
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          }
        >
          <p className="text-sm text-muted-foreground">
            Unknown signals remain visible rather than being reported as healthy.
          </p>
        </SettingsSection>

        {/* Performance Monitoring */}
        <SettingsSection
          title="Performance Monitoring"
          description="Monitor SLA query performance and system metrics"
          action={
            <Link href="/settings/system/performance">
              <Button variant="outline">
                View Metrics
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          }
        >
          <p className="text-sm text-muted-foreground">
            Track query durations, slow queries, and optimization opportunities.
          </p>
        </SettingsSection>
      </div>
    );
  } catch (error) {
    logger.error('[SystemSettings] Critical rendering error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return (
      <div className="p-6 space-y-6">
        <SettingsPageHeader title="System Settings" backHref="/settings" />
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
        <Button onClick={() => window.location.reload()} variant="outline">
          Retry Loading
        </Button>
      </div>
    );
  }
}
