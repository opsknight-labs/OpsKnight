'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Shield,
  Key,
  Users,
  Sliders,
  Globe,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import RoleMappingEditor, { type RoleMappingRule } from '@/components/settings/RoleMappingEditor';
import { saveOidcConfig, validateOidcConnectionAction } from '@/app/(app)/settings/system/actions';

type ProfileMapping = {
  department?: string;
  jobTitle?: string;
  avatarUrl?: string;
};

type OidcConfig = {
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
  profileMapping?: ProfileMapping | null;
};

type Props = {
  initialConfig: OidcConfig | null;
  callbackUrl: string;
  hasEncryptionKey: boolean;
  configError?: string;
};

type State = {
  error?: string | null;
  success?: boolean;
};

type Preset = {
  id: string;
  label: string;
  issuer: string;
  note: string;
};

const PROVIDER_PRESETS: Preset[] = [
  {
    id: 'okta',
    label: 'Okta',
    issuer: 'https://{yourOktaDomain}/oauth2/default',
    note: 'Use your Okta org or custom authorization server.',
  },
  {
    id: 'azure',
    label: 'Azure AD',
    issuer: 'https://login.microsoftonline.com/{tenantId}/v2.0',
    note: 'Replace {tenantId} with your directory ID.',
  },
  {
    id: 'auth0',
    label: 'Auth0',
    issuer: 'https://{tenant}.us.auth0.com/',
    note: 'Use your Auth0 tenant domain.',
  },
  {
    id: 'google',
    label: 'Google',
    issuer: 'https://accounts.google.com',
    note: 'Google Workspace uses a fixed issuer.',
  },
  {
    id: 'custom',
    label: 'Custom',
    issuer: '',
    note: 'Enter the issuer URL from your provider.',
  },
];

type ValidationErrors = {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Saving...' : 'Save SSO Settings'}
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="whitespace-nowrap h-8 text-xs gap-1.5"
      aria-live="polite"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export default function SsoSettingsForm({
  initialConfig,
  callbackUrl,
  hasEncryptionKey,
  configError,
}: Props) {
  const [state, formAction] = useActionState<State, FormData>(saveOidcConfig, {
    error: null,
    success: false,
  });
  const initialIssuer = initialConfig?.issuer ?? '';
  const initialClientId = initialConfig?.clientId ?? '';
  const initialDomains = (initialConfig?.allowedDomains ?? []).join(', ');
  const initialEnabled = initialConfig?.enabled ?? false;
  const initialProviderLabel = initialConfig?.providerLabel ?? '';
  const initialCustomScopes = initialConfig?.customScopes ?? '';
  const initialAutoProvision = initialConfig?.autoProvision ?? true;
  const initialRoleMapping = Array.isArray(initialConfig?.roleMapping)
    ? initialConfig?.roleMapping
    : [];

  const [domains, setDomains] = useState(initialDomains);
  const [issuerUrl, setIssuerUrl] = useState(initialIssuer);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [clientIdValue, setClientIdValue] = useState(initialClientId);
  const [clientSecretValue, setClientSecretValue] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [providerLabelValue, setProviderLabelValue] = useState(initialProviderLabel);
  const [customScopesValue, setCustomScopesValue] = useState(initialCustomScopes);
  const [autoProvision, setAutoProvision] = useState(initialAutoProvision);
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const match = PROVIDER_PRESETS.find(preset => preset.issuer === initialIssuer);
    return match?.id ?? 'custom';
  });
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [lastTested, setLastTested] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [roleMappingPreview, setRoleMappingPreview] =
    useState<RoleMappingRule[]>(initialRoleMapping);
  const [roleMappingResetKey, setRoleMappingResetKey] = useState(0);

  const handleTestConnection = async () => {
    if (!issuerUrl) {
      setTestStatus('error');
      setTestMessage('Enter an issuer URL to test the connection.');
      return;
    }
    setTestStatus('testing');
    setTestMessage('Testing connection...');

    try {
      const result = await validateOidcConnectionAction(issuerUrl);
      if (result.isValid) {
        setTestStatus('success');
        setTestMessage('Connection successful.');
        setLastTested(new Date().toLocaleString());
      } else {
        setTestStatus('error');
        setTestMessage(result.error || 'Connection failed.');
        setLastTested(new Date().toLocaleString());
      }
    } catch {
      setTestStatus('error');
      setTestMessage('Unexpected error while testing.');
      setLastTested(new Date().toLocaleString());
    }
  };

  const clientSecretRequired = !initialConfig?.hasClientSecret;
  const selectedPresetNote =
    PROVIDER_PRESETS.find(preset => preset.id === selectedPreset)?.note ??
    'Enter the issuer URL from your provider.';
  const isRoleMappingDirty =
    JSON.stringify(roleMappingPreview) !== JSON.stringify(initialRoleMapping);
  const isDirty =
    enabled !== initialEnabled ||
    issuerUrl.trim() !== initialIssuer.trim() ||
    clientIdValue.trim() !== initialClientId.trim() ||
    clientSecretValue.trim().length > 0 ||
    domains.trim() !== initialDomains.trim() ||
    providerLabelValue.trim() !== initialProviderLabel.trim() ||
    customScopesValue.trim() !== initialCustomScopes.trim() ||
    autoProvision !== initialAutoProvision ||
    isRoleMappingDirty;
  const isIssuerValid = (value: string) => {
    if (!value.trim()) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  };
  const isSaveDisabled =
    !isIssuerValid(issuerUrl) ||
    !clientIdValue.trim() ||
    (clientSecretRequired && !clientSecretValue.trim());
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    if (state?.success) {
      setLastSaved(new Date().toLocaleString());
    }
  }, [state?.success]);

  const validateFields = () => {
    const errors: ValidationErrors = {};
    if (!issuerUrl.trim()) {
      errors.issuer = 'Issuer URL is required.';
    } else if (!isIssuerValid(issuerUrl)) {
      errors.issuer = 'Issuer URL must be a valid HTTPS URL.';
    }
    if (!clientIdValue.trim()) {
      errors.clientId = 'Client ID is required.';
    }
    if (clientSecretRequired && !clientSecretValue.trim()) {
      errors.clientSecret = 'Client secret is required for new configurations.';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePresetSelect = (preset: Preset) => {
    setSelectedPreset(preset.id);
    if (preset.issuer) {
      setIssuerUrl(preset.issuer);
    } else {
      setIssuerUrl('');
    }
    setTestStatus('idle');
    setValidationErrors(current => ({ ...current, issuer: undefined }));
  };

  return (
    <form
      action={formAction}
      onSubmit={event => {
        if (!validateFields()) {
          event.preventDefault();
        }
      }}
      onReset={() => {
        setIssuerUrl(initialIssuer);
        setClientIdValue(initialClientId);
        setClientSecretValue('');
        setDomains(initialDomains);
        setEnabled(initialEnabled);
        setProviderLabelValue(initialProviderLabel);
        setCustomScopesValue(initialCustomScopes);
        setAutoProvision(initialAutoProvision);
        setSelectedPreset(
          PROVIDER_PRESETS.find(preset => preset.issuer === initialIssuer)?.id ?? 'custom'
        );
        setTestStatus('idle');
        setTestMessage('');
        setLastTested(null);
        setValidationErrors({});
        setRoleMappingPreview(initialRoleMapping);
        setRoleMappingResetKey(current => current + 1);
      }}
      className="space-y-6"
    >
      {/* ── System Alerts ── */}
      {!hasEncryptionKey && (
        <Alert className="bg-amber-500/10 border-amber-500/30">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-700 dark:text-amber-300">
            Encryption key is required before saving SSO secrets. Set{' '}
            <code className="font-mono text-xs">ENCRYPTION_KEY</code> in your environment.
          </AlertDescription>
        </Alert>
      )}
      {configError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Configuration error:</strong> {configError}
          </AlertDescription>
        </Alert>
      )}

      {/* ════════════════════════════════════════════════
          CARD 1: SSO ACTIVATION & REDIRECT URI
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-foreground">Single Sign-On (OIDC)</h3>
                <Badge variant={enabled ? 'success' : 'neutral'} className="text-xs font-semibold">
                  {enabled ? 'Active' : 'Disabled'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Allow workspace members to authenticate securely through your enterprise identity
                provider.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
            <Label
              htmlFor="sso-enabled"
              className="text-xs font-medium text-muted-foreground cursor-pointer"
            >
              {enabled ? 'SSO Enabled' : 'SSO Disabled'}
            </Label>
            <Switch
              id="sso-enabled"
              name="enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
        </div>

        {/* Redirect URI Box */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Authorized Redirect URI (Callback URL)
              </span>
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                Required for IdP setup
              </Badge>
            </div>
            <a
              href="https://next-auth.js.org/providers/oidc"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium"
            >
              OIDC Docs
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs sm:text-sm font-mono font-bold text-foreground flex-1 truncate select-all bg-background/80 px-3 py-1.5 rounded-md border">
              {callbackUrl}
            </code>
            <CopyButton text={callbackUrl} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Register this exact URL in your IdP application settings before attempting connection
            tests.
          </p>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          CARD 2: IDENTITY PROVIDER CREDENTIALS
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-start sm:items-center gap-3.5 pb-4 border-b">
          <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 shrink-0">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Identity Provider Credentials</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Configure the OIDC discovery endpoint and client authentication credentials from your
              provider.
            </p>
          </div>
        </div>

        {/* Provider Templates */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Provider Template
          </Label>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_PRESETS.map(preset => {
              const isSelected = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/80'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{selectedPresetNote}</p>
        </div>

        {/* Issuer URL */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="issuer-url" className="text-sm font-semibold">
              Issuer URL <span className="text-destructive">*</span>
            </Label>
            <span className="text-[11px] text-muted-foreground">HTTPS OIDC discovery base</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="issuer-url"
                type="url"
                name="issuer"
                placeholder="https://login.company.com"
                value={issuerUrl}
                onChange={event => {
                  setIssuerUrl(event.target.value);
                  setTestStatus('idle');
                  if (validationErrors.issuer) {
                    setValidationErrors(current => ({ ...current, issuer: undefined }));
                  }
                }}
                className={`pl-9 font-mono text-sm h-10 ${validationErrors.issuer ? 'border-destructive' : ''}`}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testStatus === 'testing' || !issuerUrl}
              className="h-10 text-xs gap-1.5 shrink-0 px-4 font-semibold"
            >
              {testStatus === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
          </div>
          {validationErrors.issuer && (
            <p className="text-xs text-destructive flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3 w-3" />
              {validationErrors.issuer}
            </p>
          )}

          {/* Live Test Feedback */}
          {testStatus !== 'idle' && (
            <div
              className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${
                testStatus === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : testStatus === 'error'
                    ? 'bg-destructive/10 border-destructive/30 text-destructive'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {testStatus === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <div className="flex-1">
                <span className="font-semibold">{testMessage}</span>
                {lastTested && <span className="opacity-70 ml-2">({lastTested})</span>}
              </div>
            </div>
          )}
        </div>

        {/* Client ID & Client Secret in a 2-Column Responsive Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Client ID */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="client-id" className="text-sm font-semibold">
                Client ID <span className="text-destructive">*</span>
              </Label>
              <a
                href="https://openid.net/specs/openid-connect-core-1_0.html#ClientAuthentication"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
              >
                Help <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <Input
              id="client-id"
              type="text"
              name="clientId"
              placeholder="e.g. 0oa123abcXYZ"
              value={clientIdValue}
              onChange={event => {
                setClientIdValue(event.target.value);
                if (validationErrors.clientId) {
                  setValidationErrors(current => ({ ...current, clientId: undefined }));
                }
              }}
              className={`font-mono text-sm h-10 ${validationErrors.clientId ? 'border-destructive' : ''}`}
            />
            {validationErrors.clientId && (
              <p className="text-xs text-destructive flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3 w-3" />
                {validationErrors.clientId}
              </p>
            )}
          </div>

          {/* Client Secret */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="client-secret" className="text-sm font-semibold">
                Client Secret{' '}
                {clientSecretRequired ? (
                  <span className="text-destructive">*</span>
                ) : (
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional to update)
                  </span>
                )}
              </Label>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3 text-muted-foreground" />
                Encrypted at rest
              </span>
            </div>
            <div className="relative">
              <Input
                id="client-secret"
                type={showSecret ? 'text' : 'password'}
                name="clientSecret"
                placeholder={
                  initialConfig?.hasClientSecret
                    ? '••••••••  (Secret configured)'
                    : 'Enter client secret'
                }
                autoComplete="off"
                value={clientSecretValue}
                onChange={event => {
                  setClientSecretValue(event.target.value);
                  if (validationErrors.clientSecret) {
                    setValidationErrors(current => ({ ...current, clientSecret: undefined }));
                  }
                }}
                className={`font-mono text-sm h-10 pr-10 ${validationErrors.clientSecret ? 'border-destructive' : ''}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                title={showSecret ? 'Hide secret' : 'Show secret'}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {validationErrors.clientSecret && (
              <p className="text-xs text-destructive flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3 w-3" />
                {validationErrors.clientSecret}
              </p>
            )}
          </div>
        </div>

        {/* Sign-in Button Label */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="provider-label" className="text-sm font-semibold">
              Custom Button Label
            </Label>
            <span className="text-[11px] text-muted-foreground">Optional sign-in display text</span>
          </div>
          <Input
            id="provider-label"
            type="text"
            name="providerLabel"
            placeholder="Auto-detect from issuer"
            value={providerLabelValue}
            onChange={event => setProviderLabelValue(event.target.value)}
            className="text-sm h-10"
          />
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          CARD 3: USER PROVISIONING & RESTRICTIONS
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-start sm:items-center gap-3.5 pb-4 border-b">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">
              User Provisioning & Restrictions
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Control how accounts are created upon login and enforce company domain boundaries.
            </p>
          </div>
        </div>

        {/* JIT Switch Tile */}
        <div className="rounded-xl border bg-muted/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="auto-provision" className="text-sm font-semibold cursor-pointer">
              Just-In-Time (JIT) Account Auto-Provisioning
            </Label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automatically create an OpsKnight user account on first successful SSO sign-in.
              Disable to require existing administrator invitations.
            </p>
          </div>
          <Switch
            id="auto-provision"
            name="autoProvision"
            checked={autoProvision}
            onCheckedChange={setAutoProvision}
            className="shrink-0"
          />
        </div>

        {/* Allowed Domains */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="allowed-domains" className="text-sm font-semibold">
              Allowed Email Domains
            </Label>
            <span className="text-[11px] text-muted-foreground">Comma-separated whitelist</span>
          </div>
          <Input
            id="allowed-domains"
            type="text"
            name="allowedDomains"
            placeholder="e.g. acme.com, engineering.acme.com"
            value={domains}
            onChange={event => setDomains(event.target.value)}
            className="font-mono text-sm h-10"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to allow any domain verified and sent by your identity provider.
          </p>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          CARD 4: ADVANCED MAPPING & CLAIMS
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex items-start sm:items-center gap-3.5 pb-4 border-b">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
            <Sliders className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Claims, Scopes & Role Mapping</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Assign OpsKnight roles dynamically and sync profile fields from OIDC token claims.
            </p>
          </div>
        </div>

        {/* Custom Scopes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="custom-scopes" className="text-sm font-semibold">
              Custom OIDC Scopes
            </Label>
            <span className="text-[11px] text-muted-foreground">
              openid, email, profile included by default
            </span>
          </div>
          <Input
            id="custom-scopes"
            type="text"
            name="customScopes"
            placeholder="e.g. groups department offline_access"
            value={customScopesValue}
            onChange={event => setCustomScopesValue(event.target.value)}
            className="font-mono text-sm h-10"
          />
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] text-muted-foreground mr-1">Quick add:</span>
            {['groups', 'offline_access', 'roles'].map(scope => {
              const currentScopes = customScopesValue.split(/\s+/).filter(Boolean);
              const isIncluded = currentScopes.includes(scope);
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => {
                    if (isIncluded) {
                      setCustomScopesValue(currentScopes.filter(s => s !== scope).join(' '));
                    } else {
                      setCustomScopesValue([...currentScopes, scope].join(' '));
                    }
                  }}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                    isIncluded
                      ? 'bg-primary/10 border-primary/30 text-primary font-semibold'
                      : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/80'
                  }`}
                >
                  {isIncluded ? `✓ ${scope}` : `+ ${scope}`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Role Mapping Rule Builder (via rewritten RoleMappingEditor) */}
        <div className="space-y-3 pt-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Claim-to-Role Mapping Rules</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically grant Admin, Responder, or Auditor roles based on user group or role
              claims.
            </p>
          </div>
          <RoleMappingEditor
            key={roleMappingResetKey}
            initialMappings={initialRoleMapping}
            onChange={setRoleMappingPreview}
          />
        </div>

        {/* Profile Attribute Mapping Grid */}
        <div className="space-y-3 pt-4 border-t">
          <div>
            <h4 className="text-sm font-semibold text-foreground">User Profile Attribute Claims</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Map IdP token claim names to user profile properties on each login.
            </p>
          </div>
          {enabled ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
                <Label htmlFor="claim-dept" className="text-xs font-semibold">
                  Department Claim
                </Label>
                <Input
                  id="claim-dept"
                  type="text"
                  name="profileMapping.department"
                  placeholder="e.g. department"
                  defaultValue={initialConfig?.profileMapping?.department ?? ''}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
                <Label htmlFor="claim-title" className="text-xs font-semibold">
                  Job Title Claim
                </Label>
                <Input
                  id="claim-title"
                  type="text"
                  name="profileMapping.jobTitle"
                  placeholder="e.g. title"
                  defaultValue={initialConfig?.profileMapping?.jobTitle ?? ''}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
                <Label htmlFor="claim-avatar" className="text-xs font-semibold">
                  Avatar URL Claim
                </Label>
                <Input
                  id="claim-avatar"
                  type="text"
                  name="profileMapping.avatarUrl"
                  placeholder="e.g. picture"
                  defaultValue={initialConfig?.profileMapping?.avatarUrl ?? ''}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Enable SSO in Card 1 to configure profile attribute claims.</span>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          CARD 5: PRE-ACTIVATION ADVISORY & SAVE BAR
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-amber-500/5 border-amber-500/25 p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="space-y-0.5 text-xs">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            Verify Before Enforcing Workspace-Wide
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Always verify the callback URL and login flow in a private browser window before asking
            team members to use SSO. Misconfigured credentials can lock users out of OpsKnight.
          </p>
        </div>
      </div>

      {/* State alerts */}
      {state?.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.success && (
        <Alert className="bg-emerald-500/10 border-emerald-500/30">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="text-emerald-700 dark:text-emerald-300 font-medium">
            SSO configuration saved successfully.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Bottom Save Action Bar ── */}
      <div className="sticky bottom-4 z-10 rounded-xl border bg-card/95 backdrop-blur-md p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
        <div className="text-xs text-muted-foreground">
          {lastSaved ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Configuration saved at {lastSaved}
            </span>
          ) : isDirty ? (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              You have unsaved changes
            </span>
          ) : (
            <span>SSO configuration is synchronized</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDirty && (
            <Button type="reset" variant="outline" size="sm" className="h-9 text-xs">
              Discard Changes
            </Button>
          )}
          <SubmitButton disabled={isSaveDisabled} />
        </div>
      </div>
    </form>
  );
}
