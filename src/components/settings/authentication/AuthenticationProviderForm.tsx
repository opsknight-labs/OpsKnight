'use client';
import { copyAuthenticationText } from './clipboard';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/shadcn/dialog';
import {
  providerDefinitions,
  switchProviderDraft,
  entraTenant,
  type ProviderType,
} from '@/lib/auth-control/provider-definitions';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import {
  Key,
  Globe,
  Copy,
  Check,
  ChevronDown,
  AlertCircle,
  Eye,
  EyeOff,
  Link2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export default function AuthenticationProviderForm() {
  const {
    configuration,
    update,
    pending,
    inputClass,
    fieldErrors,
    hasSavedSecret,
    setConfiguration,
    setProfileJson,
    setRevisionId,
    setImpact,
    setConfirmation,
    setClaimResult,
    setLinkApproved,
    setBroadAcknowledged,
    setDraftBaseConfigVersion,
    data,
    callbackUrl,
    testCallbackUrl,
  } = useAuthenticationWorkspace();
  const [nextProvider, setNextProvider] = useState<ProviderType | null>(null);
  const [advancedIssuer, setAdvancedIssuer] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const requiresExactIssuer =
    configuration.providerType === 'azure' &&
    Boolean(configuration.issuer) &&
    !entraTenant(configuration.issuer);
  const showExactIssuer = advancedIssuer || requiresExactIssuer;
  const [copyMessage, setCopyMessage] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const definition = providerDefinitions[configuration.providerType];

  const handleProviderSelect = (type: ProviderType) => {
    if (type !== configuration.providerType) {
      setNextProvider(type);
    }
  };

  const field = (
    label: string,
    key:
      | 'issuer'
      | 'clientId'
      | 'clientSecret'
      | 'providerLabel'
      | 'organizationId'
      | 'customScopes',
    help?: string,
    required = false
  ) => {
    const value = Object.entries(configuration).find(([name]) => name === key)?.[1];
    const error = Object.entries(fieldErrors).find(([name]) => name === key)?.[1];
    const isSecret = key === 'clientSecret';

    return (
      <label className="block min-w-0 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-foreground text-xs uppercase tracking-wider flex items-center gap-1.5">
            {label}
            {required && (
              <span className="text-destructive font-bold text-xs" title="Required field">
                *
              </span>
            )}
          </span>
          {isSecret && hasSavedSecret && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
              <ShieldCheck className="h-3 w-3 mr-1" />
              Secret Encrypted at Rest
            </Badge>
          )}
        </div>
        <div className="relative">
          <input
            aria-label={label}
            id={`auth-field-${key}`}
            className={`${inputClass} ${isSecret ? 'pr-10' : ''} ${error ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            value={typeof value === 'string' ? value : ''}
            type={isSecret ? (showSecret ? 'text' : 'password') : 'text'}
            autoComplete={isSecret ? 'new-password' : 'off'}
            disabled={pending}
            aria-invalid={Boolean(error)}
            aria-describedby={`auth-help-${key}`}
            placeholder={
              isSecret && hasSavedSecret
                ? '•••••••••••••••• (Leave blank to retain)'
                : undefined
            }
            onChange={event => update(key, event.target.value)}
          />
          {isSecret && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowSecret(prev => !prev)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        <span
          id={`auth-help-${key}`}
          className={`block text-xs leading-relaxed ${error ? 'text-destructive font-medium flex items-center gap-1' : 'text-muted-foreground'}`}
        >
          {error ? (
            <>
              <AlertCircle className="h-3 w-3 shrink-0 inline" />
              {error}
            </>
          ) : (
            help
          )}
        </span>
      </label>
    );
  };

  return (
    <div className="min-w-0 space-y-6">
      {/* 1. Identity Provider Selector Card */}
      <div className="rounded-xl border bg-card p-5 space-y-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Supported Identity Providers
            </h3>
            <Badge variant="outline" className="text-xs">
              OIDC 1.0 Compliant
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Select an enterprise directory or federated OIDC provider. Switching providers resets candidate draft values.
          </p>
        </div>

        {/* Visual Provider Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
          {Object.entries(providerDefinitions).map(([id, provider]) => {
            const isSelected = configuration.providerType === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleProviderSelect(id as ProviderType)}
                disabled={pending}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                  isSelected
                    ? 'border-primary bg-primary/10 shadow-xs ring-1 ring-primary'
                    : 'border-border/80 bg-muted/20 hover:bg-muted/40 hover:border-border'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1.5">
                  <span className="font-bold text-xs truncate text-foreground">
                    {provider.label}
                  </span>
                  {isSelected && (
                    <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground line-clamp-1">
                  {id === 'azure' ? 'Microsoft 365' : id === 'google' ? 'Google Workspace' : id === 'okta' ? 'Okta Org' : id === 'auth0' ? 'Auth0 Tenant' : 'Custom OIDC'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Semantic Select element for accessible keyboard navigation and testing */}
        <label className="block space-y-1 text-sm pt-1">
          <span className="font-medium text-xs text-muted-foreground">
            Identity provider
          </span>
          <select
            id="auth-field-providerType"
            className={inputClass}
            value={configuration.providerType}
            disabled={pending}
            onChange={event => {
              if (event.target.value !== configuration.providerType)
                setNextProvider(event.target.value as ProviderType);
            }}
          >
            {Object.entries(providerDefinitions).map(([id, provider]) => (
              <option key={id} value={id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{definition.help}</p>
      </div>

      {/* 2. Provider Credentials Card */}
      <div className="rounded-xl border bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 pb-2 border-b">
          <Key className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Provider Credentials &amp; Discovery
          </h3>
        </div>

        {definition.tenant && !showExactIssuer && (
          <label className="block space-y-1.5 text-sm">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider flex items-center gap-1">
              Directory (tenant) ID
              <span className="text-destructive font-bold">*</span>
            </span>
            <input
              id="auth-field-issuer"
              className={`${inputClass} font-mono text-xs`}
              value={entraTenant(configuration.issuer)}
              disabled={pending}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={event =>
                update(
                  'issuer',
                  event.target.value
                    ? `https://login.microsoftonline.com/${event.target.value.trim()}/v2.0`
                    : ''
                )
              }
              aria-describedby="entra-tenant-help"
              aria-invalid={Boolean(fieldErrors.issuer)}
            />
            <span
              id="entra-tenant-help"
              className={`block text-xs leading-relaxed ${fieldErrors.issuer ? 'text-destructive font-medium flex items-center gap-1' : 'text-muted-foreground'}`}
            >
              {fieldErrors.issuer ? (
                <>
                  <AlertCircle className="h-3 w-3 shrink-0 inline" />
                  {fieldErrors.issuer}
                </>
              ) : configuration.issuer ? (
                `Issuer generated from this tenant: ${configuration.issuer}`
              ) : (
                'Find this directory ID in Microsoft Entra Admin Center → App registrations → Overview.'
              )}
            </span>
          </label>
        )}

        {!definition.tenant &&
          configuration.providerType !== 'google' &&
          field(
            'Issuer',
            'issuer',
            'Use the exact HTTPS issuer URL from your provider discovery document (.well-known/openid-configuration).',
            true
          )}

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {field(
            'Client ID',
            'clientId',
            'The application identifier assigned by your identity provider.',
            true
          )}
          {field(
            'Client secret',
            'clientSecret',
            hasSavedSecret
              ? 'Leave blank to retain the saved secret for this same issuer and Client ID.'
              : 'Enter the client secret generated by your provider. It is encrypted at rest using AES-256.',
            !hasSavedSecret
          )}
        </div>

        {field(
          'Provider display name',
          'providerLabel',
          'Optional friendly brand name shown on the login button (e.g. "Acme Corp Okta").'
        )}
      </div>

      {/* 3. Callback URLs Registration Card */}
      <section
        className="rounded-xl border bg-muted/20 p-5 space-y-4 shadow-xs"
        aria-labelledby="authentication-callback-title"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <h3 id="authentication-callback-title" className="text-sm font-bold text-foreground">
              Register both callback URLs
            </h3>
          </div>
          <Badge variant="outline" className="text-[10px] w-fit">
            Required in IdP Redirect URIs
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The test callback verifies your administrator against a staged draft. The production
          callback handles normal sign-in after activation. Register both exact URLs as Web redirect
          URIs in your provider’s console.
        </p>

        <div className="space-y-3 pt-1">
          {[
            ['Production callback', callbackUrl, 'production'],
            ['Administrator test callback', testCallbackUrl, 'test'],
          ].map(([label, value, key]) => {
            const isCopied = copiedKey === key;
            return (
              <div key={label} className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    readOnly
                    value={value}
                    className={`${inputClass} font-mono text-xs bg-muted/40 select-all`}
                    onFocus={event => event.target.select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-xs gap-1.5 shrink-0"
                    onClick={() => {
                      void copyAuthenticationText(value).then(copied => {
                        if (copied) {
                          setCopiedKey(key);
                          setCopyMessage(`${label} copied.`);
                          setTimeout(() => setCopiedKey(null), 2000);
                        } else {
                          setCopyMessage(
                            'Clipboard unavailable. Select the URL field and copy it manually.'
                          );
                        }
                      });
                    }}
                    aria-label={`Copy ${label.toLowerCase()}`}
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{isCopied ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {copyMessage && (
          <p role="status" className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            {copyMessage}
          </p>
        )}
      </section>

      {/* 4. Advanced Settings Collapsible Card */}
      <details
        key={String(requiresExactIssuer)}
        open={requiresExactIssuer || undefined}
        className="group rounded-xl border bg-card p-4 space-y-4 shadow-xs transition-all duration-200"
      >
        <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-foreground select-none list-none">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span>Advanced provider settings</span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Change these only when required by your provider. The server validates the exact issuer
          and discovery metadata before staging.
        </p>

        <div className="space-y-4 pt-2 border-t">
          {definition.tenant && (
            <label className="flex items-start gap-2.5 text-sm p-3 rounded-lg border bg-muted/20">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-input"
                checked={showExactIssuer}
                disabled={requiresExactIssuer}
                onChange={event => setAdvancedIssuer(event.target.checked)}
              />
              <span className="text-xs leading-relaxed text-foreground">
                Edit the exact issuer, including supported sovereign-cloud authorities (US Government, China, or custom private clouds).
              </span>
            </label>
          )}

          {(showExactIssuer || configuration.providerType === 'google') &&
            field(
              'Exact issuer',
              'issuer',
              'Google normally uses https://accounts.google.com. Microsoft authorities must be tenant-specific.'
            )}

          {definition.organization &&
            field(
              'Auth0 organization ID',
              'organizationId',
              'Optional Auth0 Organization ID. It is never sent for another provider.'
            )}

          <label className="block space-y-1.5 text-sm">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
              Client authentication at the token endpoint
            </span>
            <select
              className={inputClass}
              value={configuration.tokenEndpointAuthMethod}
              disabled={pending}
              onChange={event =>
                update(
                  'tokenEndpointAuthMethod',
                  event.target.value as 'client_secret_basic' | 'client_secret_post'
                )
              }
            >
              <option value="client_secret_basic">HTTP Basic · client_secret_basic</option>
              <option value="client_secret_post">Request body · client_secret_post</option>
            </select>
            <span className="text-xs text-muted-foreground block">
              Choose the method your provider advertises. Discovery checks support before staging.
            </span>
          </label>

          {field(
            'Additional scopes',
            'customScopes',
            'openid, email and profile are already included. Separate additional scopes with spaces.'
          )}

          <p className="text-xs text-muted-foreground">
            Profile claims and role mapping are managed in Access &amp; Provisioning and share this
            draft.
          </p>
        </div>
      </details>

      {/* Confirmation Dialog on Provider Change */}
      <Dialog
        open={Boolean(nextProvider)}
        onOpenChange={open => {
          if (!open) setNextProvider(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change identity provider?</DialogTitle>
            <DialogDescription>
              Switching clears this draft’s issuer, client credentials, provider-specific
              organization, scopes and claim rules. Account provisioning turns off. Allowed domains
              and session policies are retained. The active provider and its stored secret stay
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => {
                if (!nextProvider) return;
                setConfiguration(switchProviderDraft(configuration, nextProvider));
                setProfileJson('{}');
                setRevisionId('');
                setImpact(null);
                setConfirmation(false);
                setClaimResult(null);
                setLinkApproved(false);
                setBroadAcknowledged(false);
                setDraftBaseConfigVersion(data.providerConfigVersion);
                setAdvancedIssuer(false);
                setNextProvider(null);
              }}
            >
              Change provider draft
            </Button>
            <Button variant="outline" onClick={() => setNextProvider(null)}>
              Keep current draft
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
