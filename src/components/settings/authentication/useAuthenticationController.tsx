'use client';
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useHydrated } from '@/hooks/useHydrated';
import type { authenticationDashboard, AuthenticationSection } from '@/lib/auth-control/dashboard';
import type { enforcementPreview } from '@/lib/auth-control/oidc-revisions';
import {
  providerConfigSchema,
  type ProviderConfiguration,
} from '@/lib/auth-control/provider-config';
import { authenticationRequest } from './request';
import { useAuthenticationDraft } from './useAuthenticationDraft';
import {
  providerDraftErrors,
  providerDefinitions,
  hasBroadAdministratorRule,
} from '@/lib/auth-control/provider-definitions';
type Dashboard = Awaited<ReturnType<typeof authenticationDashboard>>;
type Preview = Awaited<ReturnType<typeof enforcementPreview>>;
function editable(value: Dashboard['activeProvider']): ProviderConfiguration {
  if (!value) throw new Error('Provider configuration unavailable.');
  const { hasClientSecret: _hasSecret, ...configuration } = value;
  return configuration;
}
export type AuthenticationConsoleProps = {
  initialData: Dashboard;
  callbackUrl: string;
  testCallbackUrl: string;
  scimSection?: ReactNode;
  emergencyOnly?: boolean;
};
export function useAuthenticationController({
  initialData,
  callbackUrl,
  testCallbackUrl,
  scimSection,
  emergencyOnly = false,
}: AuthenticationConsoleProps) {
  const router = useRouter();
  const [activeTab, setActiveTabState] = useState<AuthenticationSection>(() => {
    if (emergencyOnly) return 'emergency';
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('authTab');
      if (
        param &&
        ['overview', 'connection', 'access', 'policy', 'recovery', 'diagnostics'].includes(param)
      ) {
        return param as AuthenticationSection;
      }
    }
    return initialData.section;
  });
  const setActiveTab = useCallback((tab: AuthenticationSection) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      search.set('authTab', tab);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?${search}${window.location.hash}`
      );
    }
  }, []);
  const [sectionRequestPending, setSectionLoading] = useState(false);
  const [messageError, setMessageError] = useState(false);
  const [restoreScope, setRestoreScope] = useState<'ADMIN_ONLY' | 'INSTANCE'>('ADMIN_ONLY');
  const [originRepairConfirmed, setOriginRepairConfirmed] = useState(false);
  const [modeConfirmed, setModeConfirmed] = useState(false);
  const [data, setData] = useState(initialData);
  const sectionLoading = sectionRequestPending && data.section !== activeTab;
  const [initialConfiguration] = useState<ProviderConfiguration>(() => {
    if (!initialData.activeProvider)
      return {
        issuer: initialData.providerCompatibilityWarning ? '' : 'https://accounts.google.com',
        clientId: '',
        clientSecret: '',
        enabled: true,
        autoProvision: false,
        allowedDomains: [],
        roleMapping: [],
        customScopes: null,
        providerType: initialData.providerCompatibilityWarning ? 'custom' : 'google',
        providerLabel: null,
        organizationId: null,
        tokenEndpointAuthMethod: 'client_secret_basic',
        profileMapping: {},
        sessionMaxAgeSeconds: null,
        sessionIdleTimeoutSeconds: null,
      };
    return editable(initialData.activeProvider);
  });
  const {
    configuration,
    setConfiguration,
    profileJson,
    setProfileJson,
    draftGeneration,
    domainText,
    setDomainText,
    draftDirty,
    setDraftDirty,
    discard,
  } = useAuthenticationDraft(initialConfiguration);
  const [draftBaseConfigVersion, setDraftBaseConfigVersion] = useState(
    initialData.providerConfigVersion
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [draftDiscardRequested, setDraftDiscardRequested] = useState(false);
  const [revisionId, setRevisionIdState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('revisionId');
      if (param && initialData.revisions.some(r => r.id === param)) {
        return param;
      }
    }
    const tested = initialData.revisions.find(r => r.testedAt);
    return tested?.id ?? initialData.revisions[0]?.id ?? '';
  });
  const setRevisionId = useCallback((id: string) => {
    setRevisionIdState(id);
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      if (id) {
        search.set('revisionId', id);
      } else {
        search.delete('revisionId');
      }
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?${search}${window.location.hash}`
      );
    }
  }, []);

  useEffect(() => {
    if (data.revisions.length > 0) {
      if (!revisionId || !data.revisions.some(r => r.id === revisionId)) {
        const tested = data.revisions.find(r => r.testedAt);
        const candidate = tested ?? data.revisions[0];
        if (candidate) {
          setRevisionId(candidate.id);
        }
      }
    }
  }, [data.revisions, revisionId, setRevisionId]);
  const [adminId, setAdminId] = useState(
    data.actor.kind === 'admin'
      ? data.actor.id
      : (data.users.find(user => user.role === 'ADMIN' && user.status === 'ACTIVE')?.id ?? '')
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
  const [generatedRecovery, setGeneratedRecovery] = useState<{
    id: string;
    password: string;
  } | null>(null);
  const [recoveryReauthPassword, setRecoveryReauthPassword] = useState('');
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
  const selectedRevision = data.revisions.find(revision => revision.id === revisionId);
  const savedSecretSource = selectedRevision?.configuration ?? data.activeProvider;
  const hasSavedSecret = Boolean(
    savedSecretSource?.hasClientSecret &&
    savedSecretSource.issuer.replace(/\/$/, '') === configuration.issuer.replace(/\/$/, '') &&
    savedSecretSource.clientId === configuration.clientId
  );
  const stageDraft = async () => {
    const normalized = {
      ...configuration,
      organizationId: providerDefinitions[configuration.providerType].organization
        ? configuration.organizationId
        : null,
    };
    const errors = providerDraftErrors(normalized, hasSavedSecret);
    if (hasBroadAdministratorRule(normalized.roleMapping) && !broadAcknowledged)
      errors.roleMapping =
        'Acknowledge the broadly matching administrator rule, or replace it with a dedicated group.';
    const effectiveMaximum =
      normalized.sessionMaxAgeSeconds ?? data.inheritedSessionPolicy?.maximumAgeSeconds;
    if (
      normalized.sessionIdleTimeoutSeconds != null &&
      effectiveMaximum != null &&
      normalized.sessionIdleTimeoutSeconds > effectiveMaximum
    )
      errors.sessionIdleTimeoutSeconds =
        'Idle timeout cannot exceed the effective maximum lifetime, including an inherited maximum.';
    let profile: unknown;
    try {
      profile = JSON.parse(profileJson);
    } catch {
      errors.profileMapping = 'Enter a valid JSON object for profile claims.';
    }
    const parsed = providerConfigSchema.safeParse({ ...normalized, profileMapping: profile });
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'configuration');
        // eslint-disable-next-line security/detect-object-injection -- Field comes from the parsed provider schema and receives only an explanatory string.
        errors[field] ??=
          field === 'roleMapping'
            ? 'Each role rule needs a claim, matching value and valid role.'
            : issue.message;
      }
    if (!parsed.success || Object.keys(errors).length) {
      setFieldErrors(errors);
      setMessageError(true);
      setMessage('Check the highlighted draft fields before staging.');
      return false;
    }
    setFieldErrors({});
    return perform(async () => {
      const result = await authenticationRequest<{ revisionId: string }>({
        action: 'stage',
        configuration: parsed.data,
        acknowledgeBroadAdminRules: broadAcknowledged,
        sourceRevisionId: revisionId || undefined,
        expectedConfigVersion: draftBaseConfigVersion,
      });
      setRevisionId(result.revisionId);
      setConfiguration({ ...parsed.data, clientSecret: '' });
      setProfileJson(JSON.stringify(parsed.data.profileMapping, null, 2));
      setDraftDirty(false);
      setImpact(null);
      setConfirmation(false);
      setLinkApproved(false);
      await refresh();
      setMessage(
        'Changes staged and discovery verified. Test administrator sign-in before activation.'
      );
    });
  };
  const discardDraft = () => {
    discard();
    setFieldErrors({});
    setImpact(null);
    setConfirmation(false);
    setDraftDiscardRequested(false);
  };
  useEffect(() => {
    const allowed = emergencyOnly
      ? ['emergency', 'diagnostics']
      : ['overview', 'connection', 'access', 'policy', 'emergency', 'diagnostics'];
    const sync = () => {
      const tab = new URLSearchParams(window.location.search).get('authTab');
      if (tab && allowed.includes(tab)) setActiveTab(tab as AuthenticationSection);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [emergencyOnly, setActiveTab]);
  const update = <K extends keyof ProviderConfiguration>(
    key: K,
    value: ProviderConfiguration[K]
  ) => {
    setDraftDirty(true);
    setMessage('');
    setMessageError(false);
    setFieldErrors({});
    setImpact(null);
    setConfirmation(false);
    setConfiguration(previous => ({ ...previous, [key]: value }));
  };
  const inputClass =
    'block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const sectionClass =
    'rounded-xl border bg-card p-5 sm:p-6 shadow-xs min-w-0 scroll-mt-20 space-y-6 [&>h2]:tracking-tight';
  return {
    activeTab,
    setActiveTab,
    sectionRequestPending,
    setSectionLoading,
    messageError,
    setMessageError,
    restoreScope,
    setRestoreScope,
    draftDirty,
    draftBaseConfigVersion,
    setDraftBaseConfigVersion,
    fieldErrors,
    setFieldErrors,
    stageDraft,
    hasSavedSecret,
    discardDraft,
    draftDiscardRequested,
    setDraftDiscardRequested,
    setDraftDirty,
    originRepairConfirmed,
    setOriginRepairConfirmed,
    modeConfirmed,
    setModeConfirmed,
    data,
    setData,
    configuration,
    setConfiguration,
    revisionId,
    setRevisionId,
    adminId,
    setAdminId,
    profileJson,
    setProfileJson,
    draftGeneration,
    domainText,
    setDomainText,
    claims,
    setClaims,
    claimResult,
    setClaimResult,
    linkApproved,
    setLinkApproved,
    broadAcknowledged,
    setBroadAcknowledged,
    impact,
    setImpact,
    mode,
    setMode,
    confirmation,
    setConfirmation,
    busy,
    setPending,
    message,
    setMessage,
    generatedRecovery,
    setGeneratedRecovery,
    recoveryReauthPassword,
    setRecoveryReauthPassword,
    password,
    setPassword,
    restoreConfirmed,
    setRestoreConfirmed,
    normalMode,
    setNormalMode,
    router,
    sectionLoading,
    hydrated,
    refresh,
    pending,
    perform,
    update,
    inputClass,
    sectionClass,
    initialData,
    callbackUrl,
    testCallbackUrl,
    scimSection,
    emergencyOnly,
    editable,
  };
}
export type AuthenticationController = ReturnType<typeof useAuthenticationController>;
export const AuthenticationContext = createContext<AuthenticationController | null>(null);
export function useAuthenticationWorkspace() {
  const context = useContext(AuthenticationContext);
  if (!context) throw new Error('Authentication workspace is unavailable.');
  return context;
}
