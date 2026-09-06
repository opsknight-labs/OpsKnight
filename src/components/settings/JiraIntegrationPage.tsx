'use client';

import { useActionState, useState, useEffect, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { saveJiraConfig } from '@/app/(app)/settings/integrations/jira/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Switch } from '@/components/ui/shadcn/switch';
import { JiraLogo } from '@/components/common/BrandLogos';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import {
  CheckCircle2,
  Loader2,
  PlugZap,
  XCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  KeyRound,
  Globe,
  Mail,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';

type JiraConfigView = {
  baseUrl: string;
  userEmail: string;
  enabled: boolean;
  webhookSecretEncrypted: string | null;
  updatedAt: Date;
  updatedByUser?: {
    name: string | null;
    email: string;
  } | null;
} | null;

function displayError(error: unknown): string {
  const friendly = toUserFacingError(error, 'Jira connection failed.');
  return friendly.description || friendly.title;
}

function SubmitButton({ disabled, isDirty }: { disabled: boolean; isDirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={disabled || pending || !isDirty}
      size="sm"
      className="h-9 px-4 text-xs font-semibold gap-1.5 shadow-sm"
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving Configuration...
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5" />
          Save Changes
        </>
      )}
    </Button>
  );
}

export default function JiraIntegrationPage({
  config,
  isAdmin,
  appUrl,
}: {
  config: JiraConfigView;
  isAdmin: boolean;
  appUrl?: string;
}) {
  const [state, formAction] = useActionState(saveJiraConfig, {
    error: null,
    success: false,
  });

  // Local form states for dirty tracking and UI toggles
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [userEmail, setUserEmail] = useState(config?.userEmail ?? '');
  const [apiToken, setApiToken] = useState(config ? '********' : '');
  const [webhookSecret, setWebhookSecret] = useState(
    config?.webhookSecretEncrypted ? '********' : ''
  );
  const [enabled, setEnabled] = useState(config?.enabled ?? true);

  // UI helpers
  const [showApiToken, setShowApiToken] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [copiedCloudWebhookUrl, setCopiedCloudWebhookUrl] = useState(false);
  const [showWebhookGuide, setShowWebhookGuide] = useState(false);

  // Connection testing state
  const [testing, setTesting] = useState(false);
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const clientOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const effectiveBaseUrl =
    appUrl && appUrl !== 'http://localhost:3000'
      ? appUrl
      : clientOrigin && !clientOrigin.includes('localhost')
        ? clientOrigin
        : appUrl || clientOrigin || '';

  const [webhookUrl, setWebhookUrl] = useState<string>(
    effectiveBaseUrl ? `${effectiveBaseUrl}/api/jira/webhook` : '/api/jira/webhook'
  );

  useEffect(() => {
    if (!appUrl || appUrl === 'http://localhost:3000') {
      if (typeof window !== 'undefined' && window.location.origin) {
        setWebhookUrl(`${window.location.origin}/api/jira/webhook`);
      }
    }
  }, [appUrl]);

  // Dirty tracking
  const isDirty = useMemo(() => {
    if (!config) return Boolean(baseUrl.trim() || userEmail.trim() || apiToken.trim());
    return (
      baseUrl !== config.baseUrl ||
      userEmail !== config.userEmail ||
      (apiToken !== '********' && apiToken !== '') ||
      (webhookSecret !== '********' &&
        webhookSecret !== (config.webhookSecretEncrypted ? '********' : '')) ||
      enabled !== config.enabled
    );
  }, [config, baseUrl, userEmail, apiToken, webhookSecret, enabled]);

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhookUrl(true);
      setTimeout(() => setCopiedWebhookUrl(false), 2000);
    } catch {
      // Fallback
    }
  };

  const cloudWebhookUrl = useMemo(() => {
    if (webhookSecret && webhookSecret !== '********') {
      return `${webhookUrl}?secret=${encodeURIComponent(webhookSecret)}`;
    }
    return `${webhookUrl}?secret=YOUR_WEBHOOK_SECRET`;
  }, [webhookUrl, webhookSecret]);

  const handleCopyCloudWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(cloudWebhookUrl);
      setCopiedCloudWebhookUrl(true);
      setTimeout(() => setCopiedCloudWebhookUrl(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleGenerateSecret = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let result = 'jk_';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setWebhookSecret(result);
    setShowWebhookSecret(true);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setTestLatency(null);
    const start = performance.now();
    try {
      const response = await fetch('/api/jira/test', { method: 'POST' });
      const elapsed = Math.round(performance.now() - start);
      setTestLatency(elapsed);
      if (!response.ok) {
        throw await errorFromResponse(response, 'Jira connection failed.');
      }
      const data = await response.json();
      setTestResult({
        ok: true,
        message: data.displayName
          ? `Authenticated successfully as ${data.displayName} (${data.emailAddress || userEmail})`
          : 'Connected to Jira successfully.',
      });
    } catch (error) {
      setTestResult({
        ok: false,
        message: displayError(error),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* ── Global Alerts (Error / Success) ── */}
      {state?.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-3 shadow-sm">
          <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">Configuration Error</p>
            <p>{state.error}</p>
          </div>
        </div>
      )}

      {state?.success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-3 shadow-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">Configuration Saved</p>
            <p>Jira workspace settings and encrypted credentials updated successfully.</p>
          </div>
        </div>
      )}

      {/* ── CARD 1: Atlassian Workspace Credentials ── */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0">
              <JiraLogo className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">Workspace Credentials</h3>
                <Badge
                  variant={enabled ? 'success' : 'neutral'}
                  className="text-[10px] font-medium"
                >
                  {enabled ? 'Workflows Active' : 'Paused'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Encrypted Atlassian API credentials for ticket creation, status sync, and action
                item tracking.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1 border-border/80">
              <ShieldCheck className="h-3 w-3 text-emerald-500" />
              AES-256 Encrypted
            </Badge>
          </div>
        </div>

        {/* Form Inputs Grid */}
        <div className="grid gap-5 md:grid-cols-2">
          {/* Jira Site URL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="baseUrl"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
              >
                <Globe className="h-3.5 w-3.5" />
                Jira Site URL
              </Label>
              <span className="text-[10px] text-muted-foreground">Required</span>
            </div>
            <Input
              id="baseUrl"
              name="baseUrl"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://your-company.atlassian.net"
              className="font-mono text-xs h-9 bg-background border-border/80"
              required
              disabled={!isAdmin}
            />
            <p className="text-[11px] text-muted-foreground">
              Your Atlassian Cloud subdomain (e.g.{' '}
              <code className="bg-muted px-1 py-0.2 rounded font-mono">
                https://acme.atlassian.net
              </code>
              ).
            </p>
          </div>

          {/* Jira User Email */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="userEmail"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
              >
                <Mail className="h-3.5 w-3.5" />
                Service Account Email
              </Label>
              <span className="text-[10px] text-muted-foreground">Required</span>
            </div>
            <Input
              id="userEmail"
              name="userEmail"
              type="email"
              value={userEmail}
              onChange={e => setUserEmail(e.target.value)}
              placeholder="jira-service-account@company.com"
              className="font-mono text-xs h-9 bg-background border-border/80"
              required
              disabled={!isAdmin}
            />
            <p className="text-[11px] text-muted-foreground">
              Atlassian account email associated with the API token.
            </p>
          </div>

          {/* API Token */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="apiToken"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Atlassian API Token
              </Label>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                <span>Generate API Token in Atlassian</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="relative">
              <Input
                id="apiToken"
                name="apiToken"
                type={showApiToken ? 'text' : 'password'}
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder={config ? '••••••••••••••••' : 'Paste Jira API token'}
                className="font-mono text-xs h-9 pr-10 bg-background border-border/80"
                disabled={!isAdmin}
                required={!config}
              />
              <button
                type="button"
                onClick={() => setShowApiToken(!showApiToken)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showApiToken ? 'Hide API token' : 'Show API token'}
              >
                {showApiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Generated in Atlassian Security settings. Stored encrypted with your server encryption
              key.
            </p>
          </div>
        </div>

        {/* Enable Jira Workflows Switch */}
        <div className="rounded-lg border bg-muted/20 p-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label
              htmlFor="jira-enabled-switch"
              className="text-xs font-semibold text-foreground cursor-pointer"
            >
              Enable Jira Integration Workflows
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Allows creating linked Jira tickets directly from incident command centers and
              postmortem action items.
            </p>
          </div>
          <Switch
            id="jira-enabled-switch"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!isAdmin}
          />
          {/* Hidden input for server action form submission */}
          <input type="hidden" name="enabled" value={enabled ? 'on' : 'off'} />
        </div>
      </div>

      {/* ── CARD 2: Inbound Webhook Sync ── */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Inbound Webhook Sync</h3>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Bidirectional
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receives ticket status transitions from Jira in real time when issues are resolved,
              reassigned, or closed.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowWebhookGuide(!showWebhookGuide)}
            className="text-xs h-8 gap-1 text-primary hover:text-primary"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>{showWebhookGuide ? 'Hide Setup Guide' : 'View Setup Guide'}</span>
          </Button>
        </div>

        {/* Webhook Endpoint Capsules */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span>Jira Cloud Webhook URL</span>
                <Badge variant="neutral" className="text-[10px] font-normal">
                  Recommended for Cloud
                </Badge>
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={cloudWebhookUrl}
                  readOnly
                  className="bg-muted/40 font-mono text-xs text-foreground h-9 select-all border-border/80 pr-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCloudWebhookUrl}
                className="h-9 px-3 text-xs gap-1.5 shrink-0"
              >
                {copiedCloudWebhookUrl ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedCloudWebhookUrl ? 'Copied' : 'Copy Jira Cloud URL'}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Includes the authentication secret parameter. Use this URL in Atlassian Jira Cloud
              (since Jira Cloud WebHooks UI does not support custom HTTP headers).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              OpsKnight Webhook Endpoint
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={webhookUrl}
                  readOnly
                  className="bg-muted/40 font-mono text-xs text-foreground h-9 select-all border-border/80 pr-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyWebhookUrl}
                className="h-9 px-3 text-xs gap-1.5 shrink-0"
              >
                {copiedWebhookUrl ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedWebhookUrl ? 'Copied' : 'Copy URL'}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Base webhook endpoint for Jira Server/Data Center or proxies that forward{' '}
              <code className="bg-muted px-1 py-0.2 rounded font-mono text-[10px]">
                x-jira-webhook-secret
              </code>{' '}
              headers.
            </p>
          </div>
        </div>

        {/* Webhook Shared Secret */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="webhookSecret"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Webhook Secret Token (Optional)
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleGenerateSecret}
              className="h-6 px-2 text-[11px] text-primary gap-1"
            >
              <Sparkles className="h-3 w-3" />
              <span>Generate Random Secret</span>
            </Button>
          </div>
          <div className="relative">
            <Input
              id="webhookSecret"
              name="webhookSecret"
              type={showWebhookSecret ? 'text' : 'password'}
              value={webhookSecret}
              onChange={e => setWebhookSecret(e.target.value)}
              placeholder={
                config?.webhookSecretEncrypted
                  ? '••••••••••••••••'
                  : 'Shared secret for webhook authentication'
              }
              className="font-mono text-xs h-9 pr-10 bg-background border-border/80"
              disabled={!isAdmin}
            />
            <button
              type="button"
              onClick={() => setShowWebhookSecret(!showWebhookSecret)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showWebhookSecret ? 'Hide webhook secret' : 'Show webhook secret'}
            >
              {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Validates webhook authenticity via URL query parameter{' '}
            <code className="bg-muted px-1 py-0.2 rounded font-mono text-[10px]">?secret=</code>{' '}
            (Jira Cloud) or HTTP header{' '}
            <code className="bg-muted px-1 py-0.2 rounded font-mono text-[10px]">
              x-jira-webhook-secret
            </code>{' '}
            (Jira Server/DC).
          </p>
        </div>

        {/* Interactive Jira Webhook Setup Guide */}
        {showWebhookGuide && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-xs transition-all animate-in fade-in duration-200">
            <div className="font-semibold text-foreground flex items-center gap-2">
              <JiraLogo className="h-3.5 w-3.5" />
              <span>How to configure in Atlassian Jira</span>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground leading-relaxed">
              <li>
                Navigate to <strong>Jira Settings</strong> (Gear icon) → <strong>System</strong> →{' '}
                <strong>WebHooks</strong>.
              </li>
              <li>
                Click <strong>Create a WebHook</strong>. Give it a name like{' '}
                <code className="font-mono bg-muted px-1 py-0.5 rounded">
                  OpsKnight Incident Sync
                </code>
                .
              </li>
              <li>
                In the <strong>URL</strong> field, paste the <strong>Jira Cloud Webhook URL</strong>{' '}
                (with your secret parameter) or standard endpoint.
              </li>
              <li>
                Under <strong>Issue related events</strong>, check{' '}
                <code className="font-mono bg-muted px-1 py-0.5 rounded">created</code>,{' '}
                <code className="font-mono bg-muted px-1 py-0.5 rounded">updated</code>, and{' '}
                <code className="font-mono bg-muted px-1 py-0.5 rounded">deleted</code>.
              </li>
              <li>
                Click <strong>Save</strong> at the bottom of the Jira WebHooks page. Ticket status
                transitions (e.g. In Progress → Done) will now sync to OpsKnight automatically!
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* ── CARD 3: Connection Health & Diagnostics ── */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-emerald-500" />
              Connection Diagnostics
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verify live API credentials and reachability against your Jira Cloud instance.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!config || testing}
            onClick={testConnection}
            className="h-8 text-xs font-semibold gap-1.5 border-border/80 hover:bg-accent"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{testing ? 'Pinging Jira...' : 'Test Connection'}</span>
          </Button>
        </div>

        {/* Test Result Display */}
        {testResult ? (
          <div
            className={`rounded-lg border p-4 text-xs flex items-start gap-3 transition-all ${
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">
                  {testResult.ok ? 'Connection Verified' : 'Connection Failed'}
                </span>
                {testLatency !== null && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono border-current opacity-80"
                  >
                    {testLatency} ms
                  </Badge>
                )}
              </div>
              <p className="leading-relaxed">{testResult.message}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              Click &quot;Test Connection&quot; to verify your Jira API credentials in real time.
            </span>
            <span className="text-[11px] font-mono">Status: Ready</span>
          </div>
        )}
      </div>

      {/* ── STICKY FLOATING ACTION BAR ── */}
      <div className="sticky bottom-4 z-10 bg-card/95 backdrop-blur-md shadow-lg border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {isDirty && (
            <Badge
              variant="outline"
              className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10"
            >
              Unsaved Changes
            </Badge>
          )}
          <span>
            {config
              ? `Last modified by ${config.updatedByUser?.name || 'Administrator'} on ${new Date(config.updatedAt).toLocaleDateString()}`
              : 'Configure Atlassian Jira credentials to enable integration.'}
          </span>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <SubmitButton disabled={!isAdmin} isDirty={isDirty} />
        </div>
      </div>
    </form>
  );
}
