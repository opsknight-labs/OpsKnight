'use client';
import { hasBroadAdministratorRule } from '@/lib/auth-control/provider-definitions';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { Button } from '@/components/ui/shadcn/button';
import AuthenticationRoleRules, { ROLE_OPTIONS } from '../AuthenticationRoleRules';
import AuthenticationTeamRules from '../AuthenticationTeamRules';
import HelpHint from './HelpHint';
import { authDocs } from './setup-steps';
import { AlertTriangle, CheckCircle2, Sparkles, UserCog, XCircle } from 'lucide-react';

type ProfileFields = { department?: string; jobTitle?: string; avatarUrl?: string };

function readProfile(json: string): ProfileFields {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as ProfileFields)
      : {};
  } catch {
    return {};
  }
}

const CLAIMS_EXAMPLE = `{
  "iss": "https://login.example.com",
  "sub": "00u1abcd",
  "email": "alex@example.com",
  "email_verified": true,
  "groups": ["opsknight-admins", "platform-oncall"]
}`;

export default function AuthenticationRolesWorkspace() {
  const {
    data,
    configuration,
    update,
    profileJson,
    setProfileJson,
    setDraftDirty,
    revisionId,
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
    setMessage,
    inputClass,
    sectionClass,
    setActiveTab,
  } = useAuthenticationWorkspace();
  const profile = readProfile(profileJson);
  const setProfileField = (key: keyof ProfileFields, value: string) => {
    const next: ProfileFields = { ...profile };
    // eslint-disable-next-line security/detect-object-injection -- key is a ProfileFields literal union.
    next[key] = value.trim() || undefined;
    setProfileJson(JSON.stringify(next, null, 2));
    setDraftDirty(true);
  };
  const disabled = busy || !hydrated;
  const roleName = (role: string) =>
    ROLE_OPTIONS.find(option => option.value === role)?.label ?? role;

  return (
    <section className={sectionClass} aria-labelledby="auth-roles-title">
      <header className="space-y-1 border-b pb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <UserCog className="h-4 w-4" />
          </div>
          <h2 id="auth-roles-title" className="text-base font-bold text-foreground sm:text-lg">
            Roles &amp; teams
          </h2>
          <HelpHint label="About roles and teams" href={authDocs.roles}>
            Each time someone signs in with single sign-on, OpsKnight reads their groups or roles
            from the identity provider and applies these rules. Roles that an administrator set by
            hand are kept. If the provider says the group list was cut short (Microsoft Entra with
            more than 200 groups), nothing changes for that person.
          </HelpHint>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Optional. Give people a role and teams from their identity provider groups. Changes take
          effect at each person&apos;s next sign-in.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1.5 text-sm">
          <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
            Default role
            <HelpHint label="About the default role">
              The role for someone whose groups match no rule, and for new accounts. Most teams use
              User or Responder. Administrator is not offered: give it with a rule instead.
            </HelpHint>
          </span>
          <select
            className={inputClass}
            disabled={disabled}
            value={configuration.defaultRole}
            onChange={event =>
              update('defaultRole', event.target.value as typeof configuration.defaultRole)
            }
          >
            {ROLE_OPTIONS.filter(option => option.value !== 'ADMIN').map(option => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-1.5 text-sm">
          <legend className="text-xs font-semibold text-foreground">When no rule matches</legend>
          {(
            [
              ['DEFAULT_ROLE', 'Let them in with the default role'],
              ['DENY', 'Refuse sign-in'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="auth-unmatched-policy"
                disabled={disabled}
                checked={configuration.unmatchedPolicy === value}
                onChange={() => update('unmatchedPolicy', value)}
              />
              {label}
            </label>
          ))}
          {configuration.unmatchedPolicy === 'DENY' && (
            <p className="text-[11px] text-muted-foreground">
              Accounts whose role an administrator set by hand can still sign in.
            </p>
          )}
        </fieldset>
        <fieldset className="space-y-1.5 text-sm">
          <legend className="text-xs font-semibold text-foreground">
            When several rules match
          </legend>
          {(
            [
              ['HIGHEST_ROLE', 'Give the highest role (recommended)'],
              ['FIRST_MATCH', 'Use the first matching rule'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="auth-role-precedence"
                disabled={disabled}
                checked={configuration.rolePrecedence === value}
                onChange={() => update('rolePrecedence', value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>

      <div id="auth-field-roleMapping" tabIndex={-1} className="space-y-2">
        <AuthenticationRoleRules
          rules={configuration.roleMapping}
          precedence={configuration.rolePrecedence}
          suggestions={data.claimSuggestions}
          onChange={rules => {
            update('roleMapping', rules);
            setBroadAcknowledged(false);
          }}
          disabled={disabled}
        />
        {fieldErrors.roleMapping && (
          <p
            role="alert"
            className="flex items-center gap-1.5 pt-1 text-xs font-medium text-destructive"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {fieldErrors.roleMapping}
          </p>
        )}
      </div>

      {hasBroadAdministratorRule(configuration.roleMapping) && (
        <div
          role="note"
          className="space-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 shadow-xs dark:text-amber-100"
        >
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>This rule may make many people administrators</span>
          </div>
          <p className="leading-relaxed">
            It matches a broad group (such as everyone) or a claim that is not a group or role.
            Prefer a dedicated administrator group.
          </p>
          <label className="flex cursor-pointer items-start gap-2 pt-1 font-medium">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-input"
              disabled={pending}
              checked={broadAcknowledged}
              onChange={event => setBroadAcknowledged(event.target.checked)}
            />
            <span>I understand, and want this rule to grant Administrator.</span>
          </label>
        </div>
      )}

      <div id="auth-field-teamMapping" tabIndex={-1}>
        <AuthenticationTeamRules
          rules={configuration.teamMapping}
          teams={data.teams}
          suggestions={data.claimSuggestions}
          onChange={rules => update('teamMapping', rules)}
          disabled={disabled}
        />
        {fieldErrors.teamMapping && (
          <p role="alert" className="pt-1 text-xs font-medium text-destructive">
            {fieldErrors.teamMapping}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-foreground">Profile details from SSO</h3>
          <HelpHint label="About profile details">
            Copies these claims into each person&apos;s profile when they sign in. Leave blank to
            let people edit the field themselves. When SCIM manages a field, SCIM wins.
          </HelpHint>
        </div>
        <div id="auth-field-profileMapping" className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['department', 'Department claim', 'department'],
              ['jobTitle', 'Job title claim', 'jobTitle'],
              ['avatarUrl', 'Photo URL claim', 'picture'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="space-y-1 text-xs font-medium">
              {label}
              <input
                className={inputClass}
                disabled={pending}
                value={
                  (key === 'department'
                    ? profile.department
                    : key === 'jobTitle'
                      ? profile.jobTitle
                      : profile.avatarUrl) ?? ''
                }
                placeholder={placeholder}
                maxLength={128}
                onChange={event => setProfileField(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        {fieldErrors.profileMapping && (
          <p role="alert" className="text-xs text-destructive">
            {fieldErrors.profileMapping}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-xl border bg-muted/20 p-4 shadow-xs sm:p-5">
        <div className="flex items-center gap-2 border-b pb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Try your rules</h3>
          <HelpHint label="About trying rules">
            Paste the claims from an ID token (decode it at your provider or jwt.io, then copy the
            payload). OpsKnight checks them against your current rules, including unsaved changes.
            Never paste the token itself.
          </HelpHint>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="text-xs font-semibold text-foreground">
            Sample claims (the decoded payload, not the token)
          </span>
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={7}
            value={claims}
            placeholder={CLAIMS_EXAMPLE}
            onChange={event => {
              setClaims(event.target.value);
              setClaimResult(null);
            }}
          />
        </label>
        <AuthenticationActionGuard
          availability={actionAvailability('Check these claims', [
            pending && { code: 'busy', message: 'Wait for the current operation.' },
            !revisionId && {
              code: 'revision',
              message: 'Save your provider connection first.',
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
                let parsedClaims: Record<string, unknown>;
                try {
                  parsedClaims = JSON.parse(claims) as Record<string, unknown>;
                } catch {
                  throw new Error('Sample claims must be valid JSON, like the example shown.');
                }
                if (typeof parsedClaims.id_token === 'string' || /^eyJ/.test(claims.trim()))
                  throw new Error('That looks like a token. Paste only the decoded claims.');
                setClaimResult(
                  await authenticationRequest({
                    action: 'claims',
                    revisionId,
                    claims: parsedClaims,
                    draftRules: {
                      roleMapping: configuration.roleMapping,
                      defaultRole: configuration.defaultRole,
                      unmatchedPolicy: configuration.unmatchedPolicy,
                      rolePrecedence: configuration.rolePrecedence,
                      teamMapping: configuration.teamMapping,
                    },
                  })
                );
                setMessage('');
              })
            }
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Check these claims
          </Button>
        </AuthenticationActionGuard>

        {claimResult && (
          <div className="space-y-2 rounded-xl border bg-card p-4 text-xs shadow-xs" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {claimResult.outcome === 'REJECT' ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
              {claimResult.outcome === 'REJECT'
                ? 'This person could not sign in'
                : claimResult.effectiveRole
                  ? `Signs in as ${roleName(claimResult.effectiveRole)}`
                  : 'Signs in'}
            </p>
            <p className="text-muted-foreground">{claimResult.reason}</p>
            {claimResult.role.outcome === 'MATCHED' && claimResult.role.matchedRule && (
              <p>
                Matched rule: <code>{claimResult.role.matchedRule.claim}</code> ={' '}
                <code>{claimResult.role.matchedRule.value}</code>
              </p>
            )}
            {claimResult.roleSource === 'MANUAL' && (
              <p>This account&apos;s role was set by an administrator, so it is kept.</p>
            )}
            {claimResult.role.teams.length > 0 && <p>Teams: {claimResult.role.teams.join(', ')}</p>}
            {claimResult.warning && (
              <p className="text-amber-700 dark:text-amber-300">{claimResult.warning}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
