'use client';

import AuthenticationOverview from './AuthenticationOverview';
import AuthenticationDiagnostics from './AuthenticationDiagnostics';

import { useHydrated } from '@/hooks/useHydrated';
import { useState, useEffect, type ReactNode } from 'react';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { Badge } from '@/components/ui/shadcn/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  Shield,
  KeyRound,
  Users,
  Settings2,
  Activity,
  Globe,
  Loader2,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import AuthenticationAdminPicker from './AuthenticationAdminPicker';
import AuthenticationRoleRules from './AuthenticationRoleRules';
import AuthenticationUserDirectory from './AuthenticationUserDirectory';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import type { authenticationDashboard, AuthenticationSection } from '@/lib/auth-control/dashboard';
import type { enforcementPreview } from '@/lib/auth-control/oidc-revisions';
import { type ProviderConfiguration } from '@/lib/auth-control/provider-config';
import { Button } from '@/components/ui/shadcn/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Dashboard = Awaited<ReturnType<typeof authenticationDashboard>>;
type Preview = Awaited<ReturnType<typeof enforcementPreview>>;
const templates = {
  azure: ['Microsoft Entra ID', 'https://login.microsoftonline.com/{tenantId}/v2.0'],
  google: ['Google Workspace', 'https://accounts.google.com'],
  okta: ['Okta', 'https://{yourOktaDomain}/oauth2/default'],
  auth0: ['Auth0', 'https://{tenant}.us.auth0.com/'],
  custom: ['Generic OIDC / Keycloak', 'https://{host}/realms/{realm}'],
} as const;
function editable(value: Dashboard['activeProvider']): ProviderConfiguration {
  if (!value) throw new Error('Provider configuration unavailable.');
  const { hasClientSecret: _hasSecret, ...configuration } = value;
  return configuration;
}
export async function authenticationRequest<T>(
  payload: unknown,
  endpoint = '/api/auth/control'
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
  });
  const data = (await response.json()) as { data: T; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Authentication operation failed.');
  return data.data;
}

async function loadAuthenticationAlertHistory(
  status: NonNullable<
    Parameters<typeof import('@/lib/auth-control/dashboard').authenticationAlertHistory>[0]
  >,
  after?: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ view: 'alerts', status });
  if (after) query.set('after', after);
  const response = await fetch(`/api/auth/control?${query}`, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Delivery history unavailable.');
  return body.data as Awaited<
    ReturnType<typeof import('@/lib/auth-control/dashboard').authenticationAlertHistory>
  >;
}

export default function AuthenticationConsole({
  initialData,
  callbackUrl,
  testCallbackUrl,
  scimSection,
  emergencyOnly = false,
}: {
  initialData: Dashboard;
  callbackUrl: string;
  testCallbackUrl: string;
  scimSection?: ReactNode;
  emergencyOnly?: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AuthenticationSection>(
    emergencyOnly ? 'emergency' : 'overview'
  );
  const [sectionRequestPending, setSectionLoading] = useState(false);
  const [messageError, setMessageError] = useState(false);
  const [restoreScope, setRestoreScope] = useState<'ADMIN_ONLY' | 'INSTANCE'>('ADMIN_ONLY');
  const [draftDirty, setDraftDirty] = useState(false);
  const [originRepairConfirmed, setOriginRepairConfirmed] = useState(false);
  const [modeConfirmed, setModeConfirmed] = useState(false);
  const [data, setData] = useState(initialData);
  const sectionLoading = sectionRequestPending && data.section !== activeTab;
  const [configuration, setConfiguration] = useState<ProviderConfiguration>(() => {
    if (!initialData.activeProvider)
      return {
        issuer: 'https://accounts.google.com',
        clientId: '',
        clientSecret: '',
        enabled: true,
        autoProvision: false,
        allowedDomains: [],
        roleMapping: [],
        customScopes: null,
        providerType: 'google',
        providerLabel: null,
        organizationId: null,
        tokenEndpointAuthMethod: 'client_secret_basic',
        profileMapping: {},
        sessionMaxAgeSeconds: null,
        sessionIdleTimeoutSeconds: null,
      };
    return editable(initialData.activeProvider);
  });
  const [revisionId, setRevisionId] = useState('');
  const [adminId, setAdminId] = useState(
    data.actor.kind === 'admin'
      ? data.actor.id
      : (data.users.find(user => user.role === 'ADMIN' && user.status === 'ACTIVE')?.id ?? '')
  );
  const [profileJson, setProfileJson] = useState(
    JSON.stringify(configuration.profileMapping, null, 2)
  );
  const [claims, setClaims] = useState('{}');
  const [claimResult, setClaimResult] = useState<Awaited<
    ReturnType<typeof import('@/lib/auth-control/dashboard').identityClaimsPreview>
  > | null>(null);
  const [linkApproved, setLinkApproved] = useState(false);
  const [broadAcknowledged, setBroadAcknowledged] = useState(false);
  const [impact, setImpact] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'SSO_OPTIONAL' | 'SSO_REQUIRED'>(
    data.mode === 'SSO_REQUIRED' ? 'SSO_REQUIRED' : 'SSO_OPTIONAL'
  );
  const [confirmation, setConfirmation] = useState(false);
  const hydrated = useHydrated();
  const [busy, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [credentialChangeConfirmed, setCredentialChangeConfirmed] = useState<string | null>(null);
  const [emergencyMethod, setEmergencyMethod] = useState<'PASSWORD' | 'WEBAUTHN'>('WEBAUTHN');
  const [generatedRecovery, setGeneratedRecovery] = useState<{
    id: string;
    password: string;
  } | null>(null);
  const [recoveryReauthPassword, setRecoveryReauthPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [independent, setIndependent] = useState(false);
  const [keyName, setKeyName] = useState('Primary hardware key');
  const [compromised, setCompromised] = useState(false);
  const [password, setPassword] = useState('');
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [normalMode, setNormalMode] = useState<'PASSWORD_ONLY' | 'SSO_OPTIONAL'>('SSO_OPTIONAL');
  const refresh = async () => {
    const response = await fetch(`/api/auth/control?section=${activeTab}`, { cache: 'no-store' });
    if (!response.ok)
      throw new Error('The session ended or was revoked. Sign in again to continue.');
    setData(((await response.json()) as { data: Dashboard }).data);
  };
  useEffect(() => {
    if (data.section === activeTab) return;
    const controller = new AbortController();
    setSectionLoading(true);
    void fetch(`/api/auth/control?section=${activeTab}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || 'Unable to load this section.');
        setSectionLoading(false);
        setData(body.data);
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setSectionLoading(false);
          setMessageError(true);
          setMessage(error instanceof Error ? error.message : 'Section unavailable.');
        }
      });
    return () => controller.abort();
  }, [activeTab, data.section]);
  const pending = busy || sectionLoading || !hydrated;
  const perform = async (work: () => Promise<void>): Promise<boolean> => {
    setPending(true);
    setMessage('');
    setMessageError(false);
    try {
      await work();
      return true;
    } catch (error) {
      setMessageError(true);
      setMessage(error instanceof Error ? error.message : 'Unable to complete operation.');
      return false;
    } finally {
      setPending(false);
    }
  };
  const update = <K extends keyof ProviderConfiguration>(
    key: K,
    value: ProviderConfiguration[K]
  ) => {
    setDraftDirty(true);
    setImpact(null);
    setConfirmation(false);
    setConfiguration(previous => ({ ...previous, [key]: value }));
  };
  const inputClass =
    'block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50';
  const sectionClass =
    'scroll-mt-20 space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6 [&>h2]:border-b [&>h2]:border-border [&>h2]:pb-4 [&>h2]:tracking-tight';
  const field = (
    label: string,
    key:
      | 'issuer'
      | 'clientId'
      | 'clientSecret'
      | 'providerLabel'
      | 'organizationId'
      | 'customScopes',
    type = 'text'
  ) => (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <input
        className={inputClass}
        type={type}
        value={
          Object.entries(configuration)
            .find(([name]) => name === key)?.[1]
            ?.toString() ?? ''
        }
        onChange={event => update(key, event.target.value)}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        disabled={busy || !hydrated}
      />
    </label>
  );
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border bg-muted/40 p-2.5">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Authentication control center</p>
            <p className="text-xs text-muted-foreground">
              Secure sign-in, tested changes, independent recovery
            </p>
          </div>
        </div>
        <Badge variant={data.mode === 'SSO_REQUIRED' ? 'success' : 'neutral'}>
          {data.mode.replaceAll('_', ' ')}
        </Badge>
      </div>
      {data.originConflict && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Canonical origin needs repair</AlertTitle>
          <AlertDescription>
            SSO changes are blocked until deployment URLs agree. Recovery uses{' '}
            {data.recoveryOrigin ?? 'an unavailable origin'}
            {data.recoveryOriginPinned
              ? ' pinned by the deployment.'
              : '. Configure a trusted recovery origin before proceeding.'}
          </AlertDescription>
        </Alert>
      )}
      {(data.recoveryDegradedAt ||
        (data.verifiedEmergencyAccounts < 2 && data.mode === 'SSO_REQUIRED')) && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Recovery readiness is degraded</AlertTitle>
          <AlertDescription>
            Required remains enforced. Enroll and independently drill replacement keys immediately.
            A compromised key can always be revoked.
          </AlertDescription>
        </Alert>
      )}
      {data.passwordRecoveryUserId && (
        <Alert>
          <KeyRound className="h-4 w-4" />
          <AlertTitle>Temporary administrator password recovery</AlertTitle>
          <AlertDescription>
            Password sign-in is restricted to one administrator until{' '}
            {data.passwordRecoveryExpiresAt}. Other existing local passwords remain blocked.
          </AlertDescription>
        </Alert>
      )}
      {data.providerCompatibilityWarning && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Historical provider configuration needs review</AlertTitle>
          <AlertDescription>
            Existing SSO continues using its saved runtime configuration. Some saved values do not
            meet the staging rules and cannot be edited or rolled back here. Review the upgrade
            runbook and stage a complete validated replacement before changing production.
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert
          variant={messageError ? 'destructive' : 'default'}
          role={messageError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>
            {messageError ? 'Action could not complete' : 'Authentication update'}
          </AlertTitle>
          <AlertDescription className="break-words">{message}</AlertDescription>
        </Alert>
      )}
      <DetailTabs
        syncWithUrl={false}
        activeTab={activeTab}
        onTabChange={value => setActiveTab(value as AuthenticationSection)}
        layout="auto"
        tabs={[
          ...(!emergencyOnly
            ? [
                { id: 'overview', label: 'Overview', icon: <Shield className="h-4 w-4" /> },
                { id: 'connection', label: 'Connection', icon: <Globe className="h-4 w-4" /> },
                {
                  id: 'access',
                  label: 'Access & provisioning',
                  icon: <Users className="h-4 w-4" />,
                },
                {
                  id: 'policy',
                  label: 'Authentication policy',
                  icon: <Settings2 className="h-4 w-4" />,
                },
              ]
            : []),
          { id: 'emergency', label: 'Emergency Access', icon: <KeyRound className="h-4 w-4" /> },
          { id: 'diagnostics', label: 'Diagnostics', icon: <Activity className="h-4 w-4" /> },
        ]}
      >
        {sectionLoading && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading this section…
          </p>
        )}
        {!emergencyOnly && (
          <>
            {activeTab === 'overview' && (
              <DetailTabContent value="overview">
                <AuthenticationOverview
                  data={data}
                  className={sectionClass}
                  providerLabel={
                    data.activeProvider ? templates[data.activeProvider.providerType][0] : ''
                  }
                />
              </DetailTabContent>
            )}
            {activeTab === 'connection' && (
              <DetailTabContent value="connection">
                <section
                  id="authentication-1"
                  className={sectionClass}
                  aria-labelledby="auth-connection-title"
                >
                  <h2 id="auth-connection-title" className="text-lg font-semibold">
                    Connection
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="neutral">Editable draft</Badge>
                    {revisionId && (
                      <Badge variant="outline">
                        Based on saved revision {revisionId.slice(-8)}
                      </Badge>
                    )}
                    {draftDirty && (
                      <Badge variant="warning">Unsaved changes · stage before testing</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Stage and test a revision before activation. Editing these fields does not
                    replace production credentials.
                  </p>
                  <div className="space-y-2 text-sm">
                    <p>
                      Production callback: <code className="break-all">{callbackUrl}</code>
                    </p>
                    <p>
                      Administrator test callback:{' '}
                      <code className="break-all">{testCallbackUrl}</code>
                    </p>
                  </div>
                  <form
                    className="grid gap-4 md:grid-cols-2"
                    onSubmit={event => {
                      event.preventDefault();
                      void perform(async () => {
                        const result = await authenticationRequest<{ revisionId: string }>({
                          action: 'stage',
                          configuration: {
                            ...configuration,
                            roleMapping: configuration.roleMapping,
                            profileMapping: JSON.parse(profileJson),
                          },
                          acknowledgeBroadAdminRules: broadAcknowledged,
                          sourceRevisionId: revisionId || undefined,
                        });
                        setRevisionId(result.revisionId);
                        setConfiguration(previous => ({ ...previous, clientSecret: '' }));
                        setDraftDirty(false);
                        setImpact(null);
                        setConfirmation(false);
                        await refresh();
                        setMessage(
                          'Revision staged. Discovery is validated; a real administrator login test is still required.'
                        );
                      });
                    }}
                  >
                    <label className="block space-y-1 text-sm md:col-span-2">
                      <span>Identity provider</span>
                      <select
                        className={inputClass}
                        value={configuration.providerType}
                        disabled={pending}
                        onChange={event => {
                          const provider = event.target
                            .value as ProviderConfiguration['providerType'];
                          update('providerType', provider);
                          update(
                            'issuer',
                            Object.entries(templates).find(([name]) => name === provider)?.[1][1] ??
                              ''
                          );
                        }}
                      >
                        {Object.entries(templates).map(([key, value]) => (
                          <option value={key} key={key}>
                            {value[0]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field('Issuer', 'issuer')}
                    {field('Client ID', 'clientId')}
                    {field(
                      'Client secret (blank keeps the same client’s existing secret)',
                      'clientSecret',
                      'password'
                    )}
                    {field('Provider label', 'providerLabel')}
                    {field('Auth0 organization ID', 'organizationId')}
                    <label className="block space-y-1 text-sm">
                      <span>Token endpoint client authentication</span>
                      <select
                        className={inputClass}
                        value={configuration.tokenEndpointAuthMethod}
                        onChange={event =>
                          update(
                            'tokenEndpointAuthMethod',
                            event.target.value as ProviderConfiguration['tokenEndpointAuthMethod']
                          )
                        }
                      >
                        <option value="client_secret_basic">client_secret_basic</option>
                        <option value="client_secret_post">client_secret_post</option>
                      </select>
                    </label>
                    {field('Additional scopes (openid email profile are included)', 'customScopes')}
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={broadAcknowledged}
                        onChange={event => setBroadAcknowledged(event.target.checked)}
                      />
                      I explicitly accept any broadly matching ADMIN rules below. Prefer a dedicated
                      administrator group.
                    </label>
                    <Button
                      disabled={pending}
                      type="submit"
                      className="md:col-span-2 md:justify-self-start"
                    >
                      Stage and validate connection
                    </Button>
                  </form>
                  <label className="block space-y-1 text-sm">
                    <span>Provider revision</span>
                    <select
                      className={inputClass}
                      value={revisionId}
                      disabled={pending}
                      onChange={event => {
                        const selected = data.revisions.find(
                          revision => revision.id === event.target.value
                        );
                        setRevisionId(event.target.value);
                        if (selected) {
                          const next = editable(selected.configuration);
                          setConfiguration(next);
                          setProfileJson(JSON.stringify(next.profileMapping, null, 2));
                        }
                        setDraftDirty(false);
                        setClaimResult(null);
                        setLinkApproved(false);
                        setBroadAcknowledged(false);
                        setImpact(null);
                        setConfirmation(false);
                      }}
                    >
                      <option value="">Select a revision</option>
                      {data.revisions.map(revision => (
                        <option key={revision.id} value={revision.id}>
                          {revision.id} —{' '}
                          {revision.id === data.activeRevisionId
                            ? 'active'
                            : revision.activatedAt
                              ? 'previous'
                              : 'staged'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Discovery test:{' '}
                    {data.revisions.find(revision => revision.id === revisionId)
                      ?.discoveryVerifiedAt ?? 'not tested'}
                    . Real administrator test:{' '}
                    {data.revisions.find(revision => revision.id === revisionId)?.testedAt ??
                      'not verified'}
                    .
                  </p>
                  <AuthenticationAdminPicker
                    label="Administrator to verify"
                    value={adminId}
                    onChange={setAdminId}
                    initialAdmins={data.users.filter(
                      user => user.role === 'ADMIN' && user.status === 'ACTIVE'
                    )}
                    disabled={data.actor.kind === 'admin'}
                  />
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={linkApproved}
                      onChange={event => setLinkApproved(event.target.checked)}
                    />
                    Authorize linking this verified staged identity to the selected existing
                    administrator. Email alone never links an account.
                  </label>
                  <Button
                    disabled={pending || draftDirty || !revisionId || !adminId}
                    onClick={() =>
                      void perform(async () => {
                        const result = await authenticationRequest<{ url: string }>({
                          action: 'test',
                          revisionId,
                          adminUserId: adminId,
                          linkApproved,
                        });
                        window.location.assign(result.url);
                      })
                    }
                  >
                    Test administrator sign-in
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending || draftDirty || !revisionId}
                    onClick={() =>
                      void perform(async () => {
                        const result = await authenticationRequest<{ revisionId: string }>({
                          action: 'rollback',
                          revisionId,
                        });
                        setRevisionId(result.revisionId);
                        await refresh();
                        setMessage(
                          'Previous configuration staged as a new revision. Complete its real login test before activation.'
                        );
                      })
                    }
                  >
                    Stage selected configuration for rollback
                  </Button>
                </section>
              </DetailTabContent>
            )}
            {activeTab === 'access' && (
              <DetailTabContent value="access">
                <section
                  id="authentication-2"
                  className={sectionClass}
                  aria-labelledby="auth-access-title"
                >
                  <h2 id="auth-access-title" className="text-lg font-semibold">
                    Access &amp; provisioning
                  </h2>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={configuration.autoProvision}
                      onChange={event => update('autoProvision', event.target.checked)}
                    />
                    JIT account provisioning
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Allowed domains (comma separated; Google enforces signed hd)</span>
                    <input
                      className={inputClass}
                      value={configuration.allowedDomains.join(', ')}
                      onChange={event =>
                        update(
                          'allowedDomains',
                          event.target.value
                            .split(',')
                            .map(value => value.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </label>
                  <AuthenticationRoleRules
                    rules={configuration.roleMapping}
                    onChange={rules => {
                      update('roleMapping', rules);
                      setBroadAcknowledged(false);
                    }}
                    disabled={busy || !hydrated}
                  />
                  <label className="block space-y-1 text-sm">
                    <span>Profile claim mapping (department, jobTitle, avatarUrl)</span>
                    <textarea
                      className={inputClass}
                      rows={3}
                      value={profileJson}
                      onChange={event => {
                        setProfileJson(event.target.value);
                        setDraftDirty(true);
                      }}
                    />
                  </label>
                  <p className="text-sm">
                    Save these changes with <strong>Stage and validate connection</strong>, then
                    repeat the sign-in test. SCIM owns lifecycle independently of OIDC sign-in.
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
                  <Button
                    variant="outline"
                    disabled={pending || draftDirty || !revisionId}
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
                  {claimResult && !draftDirty && (
                    <div
                      className="space-y-3 rounded-md border border-border p-3 text-sm"
                      role="status"
                    >
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
              </DetailTabContent>
            )}
            {activeTab === 'policy' && (
              <DetailTabContent value="policy">
                <section
                  id="authentication-3"
                  className={sectionClass}
                  aria-labelledby="auth-policy-title"
                >
                  <h2 id="auth-policy-title" className="text-lg font-semibold">
                    Authentication policy
                  </h2>
                  <p className="text-sm">
                    Current mode: {data.mode.replaceAll('_', ' ')}. Sign in again or verify your
                    emergency credential within five minutes before activation.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1 text-sm">
                      <span>OIDC maximum session age (seconds)</span>
                      <input
                        type="number"
                        min={900}
                        max={2592000}
                        className={inputClass}
                        value={configuration.sessionMaxAgeSeconds ?? ''}
                        onChange={event =>
                          update(
                            'sessionMaxAgeSeconds',
                            event.target.value ? Number(event.target.value) : null
                          )
                        }
                      />
                    </label>
                    <label className="block space-y-1 text-sm">
                      <span>OIDC idle timeout (seconds)</span>
                      <input
                        type="number"
                        min={300}
                        max={604800}
                        className={inputClass}
                        value={configuration.sessionIdleTimeoutSeconds ?? ''}
                        onChange={event =>
                          update(
                            'sessionIdleTimeoutSeconds',
                            event.target.value ? Number(event.target.value) : null
                          )
                        }
                      />
                    </label>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span>Activation mode</span>
                    <select
                      className={inputClass}
                      value={mode}
                      onChange={event => {
                        setMode(event.target.value as typeof mode);
                        setConfirmation(false);
                      }}
                    >
                      <option value="SSO_OPTIONAL" disabled={data.mode === 'SSO_REQUIRED'}>
                        SSO Optional
                      </option>
                      <option value="SSO_REQUIRED">SSO Required</option>
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    disabled={pending || draftDirty || !revisionId}
                    onClick={() =>
                      void perform(async () => {
                        setImpact(
                          await authenticationRequest<Preview>({ action: 'preview', revisionId })
                        );
                        setConfirmation(false);
                      })
                    }
                  >
                    Preview enforcement impact
                  </Button>
                  {impact && (
                    <div className="space-y-2 text-sm" aria-live="polite">
                      <p>
                        {impact.passwordSessionCount} registered password sessions affected;{' '}
                        {impact.usersRequiringLinking} users require linking;{' '}
                        {impact.verifiedEmergencyAccounts} emergency identities verified.
                      </p>
                      <p>
                        Real administrator login: {impact.adminVerified ? 'verified' : 'required'}
                      </p>
                      <ul className="list-disc pl-5">
                        {impact.blockers.map(blocker => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmation}
                      onChange={event => setConfirmation(event.target.checked)}
                    />
                    I reviewed the impact and confirm activation of this verified revision and
                    sign-in policy.
                  </label>
                  <Button
                    disabled={
                      pending ||
                      draftDirty ||
                      !impact ||
                      !confirmation ||
                      !impact.adminVerified ||
                      (mode === 'SSO_REQUIRED' && impact.blockers.length > 0)
                    }
                    onClick={() =>
                      void perform(async () => {
                        await authenticationRequest({
                          action: 'activate',
                          revisionId,
                          expectedVersion: impact!.policyVersion,
                          mode,
                          confirmation: 'ACTIVATE VERIFIED SSO',
                        });
                        setConfirmation(false);
                        setImpact(null);
                        setMessage(
                          'Verified SSO activated. Disallowed sessions are revoked; complete a new sign-in if this provider changed.'
                        );
                        await refresh();
                      })
                    }
                  >
                    Activate verified SSO
                  </Button>
                  {data.actor.kind === 'admin' && (
                    <details className="space-y-3 text-sm">
                      <summary className="cursor-pointer">
                        Change to Password Only or SSO Optional
                      </summary>
                      <label className="block">
                        <span>New authentication mode</span>
                        <select
                          className={inputClass}
                          value={normalMode}
                          onChange={event => setNormalMode(event.target.value as typeof normalMode)}
                        >
                          <option value="SSO_OPTIONAL">SSO Optional</option>
                          <option value="PASSWORD_ONLY">Password Only</option>
                        </select>
                      </label>
                      <label className="block">
                        <span>Current password (required for Password Only)</span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={event => setPassword(event.target.value)}
                          className={inputClass}
                        />
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={modeConfirmed}
                          onChange={event => setModeConfirmed(event.target.checked)}
                        />
                        I confirm this deliberate sign-in policy change and its session effects.
                      </label>
                      <Button
                        variant="outline"
                        disabled={pending || !modeConfirmed}
                        onClick={() =>
                          void perform(async () => {
                            await authenticationRequest({
                              action: 'mode',
                              mode: normalMode,
                              expectedVersion: data.policyVersion,
                              currentPassword: password,
                              confirmation: 'CHANGE AUTHENTICATION POLICY',
                            });
                            setPassword('');
                            await refresh();
                          })
                        }
                      >
                        Change authentication mode
                      </Button>
                    </details>
                  )}
                </section>
              </DetailTabContent>
            )}
          </>
        )}
        {activeTab === 'emergency' && (
          <DetailTabContent value="emergency">
            <section className={sectionClass} aria-labelledby="emergency-access-title">
              <h2 id="emergency-access-title" className="text-lg font-semibold">
                Emergency Access
              </h2>
              <p className="text-sm">
                Create an independently vaulted password or enroll separately held hardware keys.
                Sign in at{' '}
                <Link
                  className="underline"
                  href="/login/emergency"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Emergency sign-in
                </Link>{' '}
                in a fresh browser session to verify each identity. There is no Remember Me.
                Recovery sessions last at most one hour and expire after 15 minutes without
                deliberate interaction.
              </p>
              {data.actor.kind === 'emergency' &&
                data.originConflict &&
                data.recoveryOriginPinned && (
                  <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <h3 className="font-semibold">Repair the configured application URL</h3>
                    <p className="text-sm text-muted-foreground">
                      Only the deployment-pinned recovery origin can be saved. First align
                      deployment URL settings on every web replica.
                    </p>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={originRepairConfirmed}
                        onChange={event => setOriginRepairConfirmed(event.target.checked)}
                      />
                      I confirm the pinned origin is the trusted URL used for these enrolled keys.
                    </label>
                    <Button
                      disabled={pending || !originRepairConfirmed}
                      variant="outline"
                      onClick={() =>
                        void perform(async () => {
                          await authenticationRequest({
                            action: 'repairOrigin',
                            expectedVersion: data.policyVersion,
                            confirmation: 'REPAIR PINNED ORIGIN',
                          });
                          await refresh();
                          setMessage(
                            'Application URL repaired. Wait for replica observations to converge, then test SSO again.'
                          );
                        })
                      }
                    >
                      Repair pinned application URL
                    </Button>
                  </div>
                )}
              <label className="block space-y-1 text-sm">
                <span>Emergency identity name</span>
                <input
                  className={inputClass}
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={independent}
                  onChange={event => setIndependent(event.target.checked)}
                />
                This identity uses a separately held vault password or hardware key, with custody
                independent of the other emergency identity and external IdP.
              </label>
              <label className="block space-y-1 text-sm">
                <span>Recovery method</span>
                <select
                  className={inputClass}
                  value={emergencyMethod}
                  onChange={event =>
                    setEmergencyMethod(event.target.value as 'PASSWORD' | 'WEBAUTHN')
                  }
                  disabled={pending}
                >
                  <option value="WEBAUTHN">Hardware security key</option>
                  <option value="PASSWORD">Generated vault password</option>
                </select>
              </label>
              {generatedRecovery && (
                <div
                  role="status"
                  className="space-y-3 rounded-md border border-amber-500 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
                >
                  <p>
                    Store this password in an independently accessible vault. It is displayed once;
                    complete a recovery sign-in drill before relying on this identity.
                  </p>
                  <p>
                    Account: <code className="break-all">{generatedRecovery.id}</code>
                  </p>
                  <code className="block break-all select-all">{generatedRecovery.password}</code>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void perform(async () => {
                        await navigator.clipboard.writeText(generatedRecovery.password);
                      })
                    }
                  >
                    Copy password
                  </Button>
                  <Button variant="outline" onClick={() => setGeneratedRecovery(null)}>
                    I stored it securely
                  </Button>
                </div>
              )}
              <Button
                disabled={pending || Boolean(generatedRecovery) || !displayName || !independent}
                onClick={() =>
                  void perform(async () => {
                    const created = await authenticationRequest<{ id: string; password?: string }>({
                      action: 'createEmergency',
                      authenticationMethod: emergencyMethod,
                      displayName,
                      independenceConfirmed: true,
                    });
                    if (created.password)
                      setGeneratedRecovery({ id: created.id, password: created.password });
                    setDisplayName('');
                    setIndependent(false);
                    await refresh();
                  })
                }
              >
                Create emergency identity
              </Button>
              <label className="block space-y-1 text-sm">
                <span>Authenticator name for enrollment</span>
                <input
                  className={inputClass}
                  value={keyName}
                  onChange={event => setKeyName(event.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={compromised}
                  onChange={event => setCompromised(event.target.checked)}
                />
                The recovery credential being revoked or rotated is confirmed compromised. This may
                reduce recovery readiness; drill a replacement promptly.
              </label>
              <ul className="space-y-4">
                {data.emergencyAccounts.map(account => (
                  <li
                    className="space-y-2 rounded-md border border-border p-3 text-sm"
                    key={account.id}
                  >
                    <p className="font-medium">
                      {account.displayName} — {account.authenticationMethod ?? 'WEBAUTHN'} —{' '}
                      {account.status}; {account.ready ? 'drill verified' : 'drill required'}
                    </p>
                    <p>
                      Account identifier: <code className="break-all">{account.id}</code>
                    </p>
                    <p>
                      Last drill: {account.verifiedAt ?? 'none'}; last used:{' '}
                      {account.lastUsedAt ?? 'never'}
                    </p>
                    <Button
                      variant="outline"
                      disabled={
                        pending ||
                        account.status === 'DISABLED' ||
                        account.authenticationMethod === 'PASSWORD'
                      }
                      onClick={() =>
                        void perform(async () => {
                          const options = await authenticationRequest<{
                            options: PublicKeyCredentialCreationOptionsJSON;
                            challengeId: string;
                          }>({ action: 'enroll', accountId: account.id });
                          const response = await (
                            await import('@simplewebauthn/browser')
                          ).startRegistration({ optionsJSON: options.options });
                          await authenticationRequest({
                            action: 'verifyEnrollment',
                            challengeId: options.challengeId,
                            displayName: keyName,
                            response,
                          });
                          setMessage(
                            'Key enrolled. Existing sessions for this emergency identity were revoked; perform a fresh sign-in drill.'
                          );
                          await refresh();
                        })
                      }
                    >
                      Enroll hardware key
                    </Button>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={credentialChangeConfirmed === account.id}
                        onChange={event =>
                          setCredentialChangeConfirmed(event.target.checked ? account.id : null)
                        }
                        disabled={pending}
                      />
                      I understand changing this credential revokes its existing sessions and
                      readiness; a new independent sign-in drill is required.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(['PASSWORD', 'WEBAUTHN'] as const).map(method => (
                        <Button
                          key={method}
                          variant="outline"
                          disabled={
                            pending ||
                            Boolean(generatedRecovery) ||
                            credentialChangeConfirmed !== account.id ||
                            account.status === 'DISABLED'
                          }
                          onClick={() =>
                            void perform(async () => {
                              const changed = await authenticationRequest<{
                                id: string;
                                password?: string;
                              }>({
                                action: 'changeEmergencyMethod',
                                confirmation: 'CHANGE RECOVERY CREDENTIAL',
                                accountId: account.id,
                                method,
                                compromised,
                                expectedVersion: account.credentialVersion,
                              });
                              setCredentialChangeConfirmed(null);
                              if (changed.password)
                                setGeneratedRecovery({
                                  id: changed.id,
                                  password: changed.password,
                                });
                              if (data.actor.kind === 'emergency' && data.actor.id === account.id) {
                                if (changed.password) {
                                  setMessage(
                                    'Your old session has been revoked. Store the new password above, then open emergency sign-in for a new drill.'
                                  );
                                  return;
                                }
                                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Disabling this identity revokes its session and requires a fresh document.
                                window.location.assign('/login/emergency');
                                return;
                              }
                              await refresh();
                            })
                          }
                        >
                          {method === 'PASSWORD'
                            ? account.authenticationMethod === 'PASSWORD'
                              ? 'Rotate password'
                              : 'Use vault password'
                            : 'Reset to hardware key'}
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      disabled={pending || account.status === 'DISABLED'}
                      onClick={() =>
                        void perform(async () => {
                          await authenticationRequest({
                            action: 'disableEmergency',
                            accountId: account.id,
                            compromised,
                          });
                          if (data.actor.kind === 'emergency' && data.actor.id === account.id) {
                            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Disabling this identity revokes its session and requires a fresh document.
                            window.location.assign('/login/emergency');
                            return;
                          }
                          await refresh();
                        })
                      }
                    >
                      Disable identity
                    </Button>
                    <ul>
                      {account.credentials.map(credential => (
                        <li
                          key={credential.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2"
                        >
                          <span>
                            {credential.displayName} — {credential.revokedAt ? 'revoked' : 'active'}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending || Boolean(credential.revokedAt)}
                            onClick={() =>
                              void perform(async () => {
                                await authenticationRequest({
                                  action: 'revoke',
                                  credentialId: credential.id,
                                  compromised,
                                });
                                if (data.actor.kind !== 'admin' && data.actor.id === account.id) {
                                  // A successful revocation invalidates this identity's current capability.
                                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Disabling this identity revokes its session and requires a fresh document.
                                  window.location.assign('/login/emergency');
                                  return;
                                }
                                await refresh();
                              })
                            }
                          >
                            Revoke key
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {data.legacyEmergencyConfigured && (
                <div className="space-y-3 text-sm">
                  <p>
                    A legacy emergency password is still configured. It grants recovery-only access.
                    Retiring it preserves its original User record and revokes legacy recovery
                    sessions.
                  </p>
                  <Button
                    variant="outline"
                    disabled={pending || data.verifiedEmergencyAccounts < 2}
                    onClick={() =>
                      void perform(async () => {
                        await authenticationRequest({ action: 'retireLegacy' });
                        await refresh();
                      })
                    }
                  >
                    Retire legacy emergency password
                  </Button>
                </div>
              )}
              {data.actor.kind !== 'admin' && (
                <div className="space-y-3 text-sm">
                  {data.actor.kind === 'emergency' &&
                    data.emergencyAccounts.find(account => account.id === data.actor.id)
                      ?.authenticationMethod === 'PASSWORD' && (
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={event => {
                          event.preventDefault();
                          void perform(async () => {
                            try {
                              await authenticationRequest(
                                {
                                  action: 'passwordReauth',
                                  accountId: data.actor.id,
                                  password: recoveryReauthPassword,
                                },
                                '/api/auth/emergency'
                              );
                              await refresh();
                            } finally {
                              setRecoveryReauthPassword('');
                            }
                          });
                        }}
                      >
                        <input
                          aria-label="Recovery password for fresh verification"
                          className={inputClass}
                          type="password"
                          autoComplete="current-password"
                          required
                          value={recoveryReauthPassword}
                          onChange={event => setRecoveryReauthPassword(event.target.value)}
                          disabled={pending}
                        />
                        <Button type="submit" disabled={pending}>
                          Verify recovery password again
                        </Button>
                      </form>
                    )}
                  {data.actor.kind === 'emergency' &&
                    data.emergencyAccounts.find(account => account.id === data.actor.id)
                      ?.authenticationMethod !== 'PASSWORD' && (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void perform(async () => {
                            const options = await authenticationRequest<{
                              options: PublicKeyCredentialRequestOptionsJSON;
                              challengeId: string;
                            }>(
                              { action: 'options', accountId: data.actor.id, reauthenticate: true },
                              '/api/auth/emergency'
                            );
                            const response = await (
                              await import('@simplewebauthn/browser')
                            ).startAuthentication({ optionsJSON: options.options });
                            await authenticationRequest(
                              { action: 'verify', challengeId: options.challengeId, response },
                              '/api/auth/emergency'
                            );
                            setMessage(
                              'Emergency credential verified again. The absolute session expiry is unchanged.'
                            );
                          })
                        }
                      >
                        Verify emergency credential again
                      </Button>
                    )}
                  {data.actor.kind === 'legacy' && (
                    <Link className="underline" href="/login/emergency">
                      Sign in again for fresh legacy verification
                    </Link>
                  )}
                  <details className="space-y-3">
                    <summary className="cursor-pointer">
                      Restore ordinary administrator access during an IdP outage
                    </summary>
                    <p>
                      This explicitly switches to Password Only and replaces the selected existing
                      administrator’s password. It revokes old sessions and reset links. Prefer
                      repairing and testing a staged provider when the IdP is available.
                    </p>
                    <label className="block space-y-2 text-sm">
                      <span className="font-medium">Password recovery scope</span>
                      <select
                        className={inputClass}
                        value={restoreScope}
                        onChange={event => {
                          setRestoreScope(event.target.value as typeof restoreScope);
                          setRestoreConfirmed(false);
                        }}
                      >
                        <option value="ADMIN_ONLY">Only this administrator · one hour</option>
                        <option value="INSTANCE">Entire instance · Password Only</option>
                      </select>
                      <p className="text-muted-foreground">
                        Instance recovery reactivates all existing local passwords and revokes OIDC
                        sessions. Choose it only when deliberately abandoning SSO enforcement.
                      </p>
                    </label>
                    <AuthenticationAdminPicker
                      label="Administrator to restore"
                      value={adminId}
                      onChange={setAdminId}
                      initialAdmins={data.users.filter(
                        user => user.role === 'ADMIN' && user.status === 'ACTIVE'
                      )}
                      disabled={data.actor.kind === 'legacy'}
                    />
                    <label className="block">
                      <span>New strong administrator password</span>
                      <input
                        className={inputClass}
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                      />
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={restoreConfirmed}
                        onChange={event => setRestoreConfirmed(event.target.checked)}
                      />
                      I authorize the selected password recovery scope for this existing
                      administrator. Other users’ local passwords stay blocked in administrator-only
                      recovery.
                    </label>
                    <Button
                      disabled={pending || !restoreConfirmed || !adminId || !password}
                      onClick={() =>
                        void perform(async () => {
                          await authenticationRequest({
                            action: 'restorePassword',
                            adminUserId: adminId,
                            password,
                            expectedVersion: data.policyVersion,
                            confirmation:
                              restoreScope === 'INSTANCE'
                                ? 'RESTORE INSTANCE PASSWORD ACCESS'
                                : 'RESTORE PASSWORD ACCESS',
                            scope: restoreScope,
                          });
                          setPassword('');
                          if (data.actor.kind === 'emergency') await refresh();
                          setMessage(
                            restoreScope === 'INSTANCE'
                              ? 'Password Only restored instance-wide. Existing local passwords can sign in.'
                              : 'Temporary password sign-in enabled only for the restored administrator for one hour. SSO policy stays unchanged.'
                          );
                        })
                      }
                    >
                      Restore password access
                    </Button>
                  </details>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        await authenticationRequest({ action: 'logout' }, '/api/auth/emergency');
                        router.replace('/login/emergency');
                      })
                    }
                  >
                    Sign out of recovery
                  </Button>
                </div>
              )}
            </section>
          </DetailTabContent>
        )}
        {activeTab === 'diagnostics' && (
          <DetailTabContent value="diagnostics">
            <AuthenticationDiagnostics
              data={data}
              pending={pending}
              onLoadHistory={loadAuthenticationAlertHistory}
              onRefresh={async () => {
                await perform(refresh);
              }}
              onRetry={(alertId, expectedGeneration) =>
                perform(async () => {
                  await authenticationRequest({
                    action: 'retryAlert',
                    alertId,
                    expectedGeneration,
                    confirmation: 'RETRY SECURITY EMAIL',
                  });
                  await refresh();
                })
              }
              onRevoke={async sessionId => {
                await perform(async () => {
                  await authenticationRequest({ action: 'revokeSession', sessionId });
                  await refresh();
                });
              }}
            />
          </DetailTabContent>
        )}
      </DetailTabs>
    </div>
  );
}
