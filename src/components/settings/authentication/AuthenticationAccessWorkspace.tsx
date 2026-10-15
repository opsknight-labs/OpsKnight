'use client';
import { hasBroadAdministratorRule } from '@/lib/auth-control/provider-definitions';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { Button } from '@/components/ui/shadcn/button';
import AuthenticationRoleRules from '../AuthenticationRoleRules';
import AuthenticationUserDirectory from '../AuthenticationUserDirectory';
export default function AuthenticationAccessWorkspace() {
  const {
    draftDirty,
    setActiveTab,
    setDraftDirty,
    data,
    configuration,
    domainText,
    setDomainText,
    revisionId,
    profileJson,
    setProfileJson,
    claims,
    setClaims,
    claimResult,
    setClaimResult,
    fieldErrors,
    broadAcknowledged,
    setBroadAcknowledged,
    busy,
    hydrated,
    pending,
    perform,
    update,
    inputClass,
    sectionClass,
    scimSection,
  } = useAuthenticationWorkspace();
  return (
    <section id="authentication-2" className={sectionClass} aria-labelledby="auth-access-title">
      <h2 id="auth-access-title" className="text-lg font-semibold">
        Access &amp; provisioning
      </h2>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          disabled={pending}
          checked={configuration.autoProvision}
          onChange={event => update('autoProvision', event.target.checked)}
        />
        JIT account provisioning
      </label>
      <label className="block space-y-1 text-sm">
        <span>Allowed domains (comma separated; Google enforces signed hd)</span>
        <input
          className={inputClass}
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.allowedDomains)}
          aria-describedby="auth-domains-help"
          id="auth-field-allowedDomains"
          value={domainText}
          onChange={event => {
            update(
              'allowedDomains',
              event.target.value
                .split(',')
                .map(value => value.trim())
                .filter(Boolean)
            );
            setDomainText(event.target.value);
          }}
        />
        <span id="auth-domains-help" className="block text-xs text-muted-foreground">
          {fieldErrors.allowedDomains ??
            'Optional. Add each permitted domain separated by a comma. Google validates signed hosted-domain claims.'}
        </span>
      </label>
      <div id="auth-field-roleMapping" tabIndex={-1} className="space-y-2">
        <AuthenticationRoleRules
          rules={configuration.roleMapping}
          onChange={rules => {
            update('roleMapping', rules);
            setBroadAcknowledged(false);
          }}
          disabled={busy || !hydrated}
        />
        {fieldErrors.roleMapping && (
          <p role="alert" className="text-sm text-destructive">
            {fieldErrors.roleMapping}
          </p>
        )}
      </div>
      {hasBroadAdministratorRule(configuration.roleMapping) && (
        <div
          role="note"
          className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        >
          <p>
            This rule can grant administrator access broadly. Prefer an exact match on a dedicated
            administrator group.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              disabled={pending}
              checked={broadAcknowledged}
              onChange={event => setBroadAcknowledged(event.target.checked)}
            />
            I explicitly acknowledge this broadly matching administrator rule.
          </label>
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span>Profile claim mapping (department, jobTitle, avatarUrl)</span>
        <textarea
          className={inputClass}
          rows={3}
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.profileMapping)}
          aria-describedby="auth-profile-help"
          id="auth-field-profileMapping"
          value={profileJson}
          onChange={event => {
            setProfileJson(event.target.value);
            setDraftDirty(true);
          }}
        />
      </label>
      <p id="auth-profile-help" className="text-xs text-muted-foreground">
        {fieldErrors.profileMapping ??
          'Map each supported profile field to a signed claim name using a JSON object.'}
      </p>
      <p className="text-sm">
        Use the shared draft bar above to save changes with <strong>Stage configuration</strong>,
        then repeat the sign-in test. SCIM owns lifecycle independently of OIDC sign-in.
      </p>
      <label className="block space-y-1 text-sm">
        <span>Sample claims for identity and role preview (never paste tokens)</span>
        <textarea
          className={inputClass}
          rows={6}
          value={claims}
          onChange={event => {
            setClaims(event.target.value);
            setClaimResult(null);
          }}
        />
      </label>
      <AuthenticationActionGuard
        availability={actionAvailability('Preview claims', [
          pending && { code: 'busy', message: 'Wait for the current operation.' },
          draftDirty && {
            code: 'draft',
            message: 'Stage the shared draft before evaluating saved role rules.',
            resolutionTarget: 'connection',
          },
          !revisionId && {
            code: 'revision',
            message: 'Select a staged configuration first.',
            resolutionTarget: 'connection',
          },
        ])}
        onResolve={setActiveTab}
      >
        <Button
          variant="outline"
          onClick={() =>
            void perform(async () => {
              setClaimResult(
                await authenticationRequest({
                  action: 'claims',
                  revisionId,
                  claims: JSON.parse(claims),
                })
              );
            })
          }
        >
          Preview identity and roles
        </Button>
      </AuthenticationActionGuard>
      {claimResult && !draftDirty && (
        <div className="space-y-3 rounded-md border border-border p-3 text-sm" role="status">
          <p>
            {'identityRecognized' in claimResult && claimResult.identityRecognized
              ? 'Identity recognized'
              : claimResult.reason}
          </p>
          {claimResult.administratorVerification && (
            <p
              className={
                claimResult.administratorVerification.ready
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }
            >
              {claimResult.administratorVerification.reason}
            </p>
          )}
          <details>
            <summary className="cursor-pointer">Claim evaluation details</summary>
            <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(claimResult, null, 2)}
            </pre>
          </details>
        </div>
      )}
      {data.actor.kind === 'admin' && <AuthenticationUserDirectory />}
      {scimSection}
    </section>
  );
}
