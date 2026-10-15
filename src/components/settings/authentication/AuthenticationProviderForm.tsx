'use client';
import { copyAuthenticationText } from './clipboard';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
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
  const [copyMessage, setCopyMessage] = useState('');
  const definition = providerDefinitions[configuration.providerType];
  const field = (
    label: string,
    key:
      | 'issuer'
      | 'clientId'
      | 'clientSecret'
      | 'providerLabel'
      | 'organizationId'
      | 'customScopes',
    help?: string
  ) => {
    const value = Object.entries(configuration).find(([name]) => name === key)?.[1];
    const error = Object.entries(fieldErrors).find(([name]) => name === key)?.[1];
    return (
      <label className="block min-w-0 space-y-1 text-sm">
        <span className="font-medium">{label}</span>
        <input
          aria-label={label}
          id={`auth-field-${key}`}
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          type={key === 'clientSecret' ? 'password' : 'text'}
          autoComplete={key === 'clientSecret' ? 'new-password' : 'off'}
          disabled={pending}
          aria-invalid={Boolean(error)}
          aria-describedby={`auth-help-${key}`}
          onChange={event => update(key, event.target.value)}
        />
        <span
          id={`auth-help-${key}`}
          className={`block text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {error ?? help}
        </span>
      </label>
    );
  };
  return (
    <div className="min-w-0 space-y-6">
      <div className="max-w-2xl space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Identity provider</span>
          <select
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
        <p className="text-sm text-muted-foreground">{definition.help}</p>
        {definition.tenant && !advancedIssuer && (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Directory (tenant) ID</span>
            <input
              id="auth-field-issuer"
              className={inputClass}
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
              className={`block text-xs ${fieldErrors.issuer ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {fieldErrors.issuer ??
                (configuration.issuer
                  ? `Issuer generated from this tenant: ${configuration.issuer}`
                  : 'Find this value in Microsoft Entra → App registrations → Overview.')}
            </span>
          </label>
        )}
        {!definition.tenant &&
          configuration.providerType !== 'google' &&
          field(
            'Issuer',
            'issuer',
            'Use the exact HTTPS issuer from your provider discovery document.'
          )}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {field(
            'Client ID',
            'clientId',
            'The application identifier issued by your identity provider.'
          )}
          {field(
            'Client secret',
            'clientSecret',
            hasSavedSecret
              ? 'Leave blank to retain the saved secret for this same issuer and Client ID.'
              : 'Enter a secret for this provider and client. It is encrypted on the server.'
          )}
        </div>
        {field(
          'Provider display name',
          'providerLabel',
          'Optional friendly name shown to administrators.'
        )}
      </div>
      <section
        className="space-y-3 border-y border-border py-4"
        aria-labelledby="authentication-callback-title"
      >
        <h3 id="authentication-callback-title" className="text-sm font-semibold">
          Register both callback URLs
        </h3>
        <p className="text-xs text-muted-foreground">
          The test callback verifies your administrator against a staged draft. The production
          callback handles normal sign-in after activation. Register both exact URLs as Web redirect
          URIs.
        </p>
        {[
          ['Production callback', callbackUrl],
          ['Administrator test callback', testCallbackUrl],
        ].map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">
              {label}
              <input
                readOnly
                value={value}
                className={`${inputClass} font-mono text-xs`}
                onFocus={event => event.target.select()}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void copyAuthenticationText(value).then(copied =>
                  setCopyMessage(
                    copied
                      ? `${label} copied.`
                      : 'Clipboard unavailable. Select the URL field and copy it manually.'
                  )
                );
              }}
              aria-label={`Copy ${label.toLowerCase()}`}
            >
              Copy
            </Button>
          </div>
        ))}
        {copyMessage && (
          <p role="status" className="text-xs text-muted-foreground">
            {copyMessage}
          </p>
        )}
      </section>
      <details className="max-w-2xl space-y-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Advanced provider settings
        </summary>
        <p className="text-xs text-muted-foreground">
          Change these only when required by your provider. The server validates the exact issuer
          and discovery metadata before staging.
        </p>
        {definition.tenant && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={advancedIssuer}
              onChange={event => setAdvancedIssuer(event.target.checked)}
            />
            Edit the exact issuer, including supported sovereign-cloud authorities.
          </label>
        )}
        {(advancedIssuer || configuration.providerType === 'google') &&
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
        <label className="block space-y-1 text-sm">
          <span>Client authentication at the token endpoint</span>
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
          <span className="text-xs text-muted-foreground">
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
      </details>
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
          <div className="flex flex-wrap gap-2">
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
