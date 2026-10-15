'use client';
import { hasBroadAdministratorRule } from '@/lib/auth-control/provider-definitions';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import AuthenticationRoleRules from '../AuthenticationRoleRules';
import AuthenticationUserDirectory from '../AuthenticationUserDirectory';
import Link from 'next/link';
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Code2,
  ChevronDown,
  UserCheck,
  ArrowRight,
} from 'lucide-react';

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
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <h2 id="auth-access-title" className="text-base sm:text-lg font-bold text-foreground">
              Access &amp; provisioning
            </h2>
            <Badge variant="outline" className="text-xs">
              {configuration.autoProvision ? 'JIT Enabled' : 'JIT Disabled'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Configure automated user onboarding, allowed email domains, and identity claim-to-role mappings.
          </p>
        </div>
      </header>

      {/* 1. JIT Account Provisioning Card */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">Just-In-Time (JIT) Provisioning</span>
            <Badge variant={configuration.autoProvision ? 'success' : 'neutral'} className="text-[10px]">
              {configuration.autoProvision ? 'Active' : 'Disabled'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Automatically register a local user account when an authorized employee signs in via SSO for the first time.
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-sm font-medium shrink-0 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            disabled={pending}
            checked={configuration.autoProvision}
            onChange={event => update('autoProvision', event.target.checked)}
          />
          <span>JIT account provisioning</span>
        </label>
      </div>

      {/* 2. Allowed Domains Card */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3 shadow-xs">
        <label className="block space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
              Allowed domains (comma separated; Google enforces signed hd)
            </span>
            <Badge variant="outline" className="text-[10px]">Security Filter</Badge>
          </div>
          <input
            className={inputClass}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.allowedDomains)}
            aria-describedby="auth-domains-help"
            id="auth-field-allowedDomains"
            value={domainText}
            placeholder="example.com, subsidiary.org"
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
          <span id="auth-domains-help" className="block text-xs text-muted-foreground leading-relaxed">
            {fieldErrors.allowedDomains ??
              'Optional. Add each permitted domain separated by a comma. Google validates signed hosted-domain claims.'}
          </span>
        </label>
      </div>

      {/* 3. Role Mapping Rules */}
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
          <p role="alert" className="text-xs text-destructive font-medium flex items-center gap-1.5 pt-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {fieldErrors.roleMapping}
          </p>
        )}
      </div>

      {hasBroadAdministratorRule(configuration.roleMapping) && (
        <div
          role="note"
          className="space-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-100 shadow-xs"
        >
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Broad Administrator Grant Warning</span>
          </div>
          <p className="leading-relaxed">
            This rule can grant administrator access broadly. Prefer an exact match on a dedicated
            administrator group.
          </p>
          <label className="flex items-start gap-2 cursor-pointer font-medium pt-1">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-input"
              disabled={pending}
              checked={broadAcknowledged}
              onChange={event => setBroadAcknowledged(event.target.checked)}
            />
            <span>I explicitly acknowledge this broadly matching administrator rule.</span>
          </label>
        </div>
      )}

      {/* 4. Profile Claim Mapping Card */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3 shadow-xs">
        <label className="block space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
              Profile claim mapping (department, jobTitle, avatarUrl)
            </span>
            <Badge variant="outline" className="text-[10px] font-mono">JSON Mapping</Badge>
          </div>
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={3}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.profileMapping)}
            aria-describedby="auth-profile-help"
            id="auth-field-profileMapping"
            value={profileJson}
            placeholder='{ "department": "dept", "jobTitle": "title" }'
            onChange={event => {
              setProfileJson(event.target.value);
              setDraftDirty(true);
            }}
          />
        </label>
        <p id="auth-profile-help" className="text-xs text-muted-foreground leading-relaxed">
          {fieldErrors.profileMapping ??
            'Map each supported profile field to a signed claim name using a JSON object.'}
        </p>
        <p className="text-xs text-muted-foreground border-t pt-2">
          Use the shared draft bar above to save changes with <strong>Stage configuration</strong>,
          then repeat the sign-in test. SCIM owns lifecycle independently of OIDC sign-in.
        </p>
      </div>

      {/* 5. Sample Claims Sandbox */}
      <div className="rounded-xl border bg-muted/20 p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 pb-2 border-b">
          <Code2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Sample Claims Evaluation Sandbox
          </h3>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
            Sample claims for identity and role preview (never paste tokens)
          </span>
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={6}
            value={claims}
            placeholder='{ "sub": "123456", "email": "admin@example.com", "groups": ["opsknight-admins"] }'
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
            className="gap-1.5"
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
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Preview identity and roles
          </Button>
        </AuthenticationActionGuard>

        {claimResult && !draftDirty && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-xs shadow-xs" role="status">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>
                {'identityRecognized' in claimResult && claimResult.identityRecognized
                  ? 'Identity recognized'
                  : claimResult.reason}
              </span>
            </div>
            {claimResult.administratorVerification && (
              <p
                className={`font-medium ${
                  claimResult.administratorVerification.ready
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {claimResult.administratorVerification.reason}
              </p>
            )}
            <details className="group pt-2 border-t">
              <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground select-none list-none">
                <span>Claim evaluation details</span>
                <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(claimResult, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      {data.actor.kind === 'admin' && <AuthenticationUserDirectory />}

      {/* Dedicated SCIM section banner */}
      <div className="rounded-xl border bg-card p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400 shrink-0">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">SCIM 2.0 User Provisioning</h3>
              <Badge variant="outline" className="text-[10px] font-semibold border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/5">
                Dedicated Section
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automate user onboarding, role updates, and deactivation directly from Okta, Entra ID, or any SCIM 2.0 compliant identity provider.
            </p>
          </div>
        </div>
        <Link href="/settings/system?section=scim">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0 font-medium">
            Open SCIM Settings
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      {scimSection && (
        <details className="group rounded-xl border bg-card p-4 space-y-3 transition-all">
          <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-foreground select-none list-none">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              <span>Configure SCIM credentials inline</span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="pt-3 border-t">
            {scimSection}
          </div>
        </details>
      )}
    </section>
  );
}
