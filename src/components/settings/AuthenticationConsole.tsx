'use client';
import AuthenticationNavigationGuard from './authentication/AuthenticationNavigationGuard';
import { providerDefinitions } from '@/lib/auth-control/provider-definitions';
import AuthenticationOverview from './AuthenticationOverview';
import AuthenticationDraftCoordinator from './authentication/AuthenticationDraftCoordinator';
import AuthenticationDiagnostics from './AuthenticationDiagnostics';
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
import type { AuthenticationSection } from '@/lib/auth-control/dashboard';
import {
  AuthenticationContext,
  useAuthenticationController,
  useAuthenticationWorkspace,
  type AuthenticationConsoleProps,
} from './authentication/useAuthenticationController';
import { authenticationRequest, loadAuthenticationAlertHistory } from './authentication/request';
export { authenticationRequest } from './authentication/request';
import AuthenticationProviderWorkspace from './authentication/AuthenticationProviderWorkspace';
import AuthenticationAccessWorkspace from './authentication/AuthenticationAccessWorkspace';
import AuthenticationPolicyWorkspace from './authentication/AuthenticationPolicyWorkspace';
import AuthenticationRecoveryWorkspace from './authentication/AuthenticationRecoveryWorkspace';

export default function AuthenticationConsole(props: AuthenticationConsoleProps) {
  const controller = useAuthenticationController(props);
  return (
    <AuthenticationContext.Provider value={controller}>
      <AuthenticationWorkspace />
    </AuthenticationContext.Provider>
  );
}

function AuthenticationWorkspace() {
  const {
    activeTab,
    setActiveTab,
    messageError,
    data,
    message,
    sectionLoading,
    refresh,
    pending,
    perform,
    sectionClass,
    emergencyOnly,
  } = useAuthenticationWorkspace();
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
            Required remains enforced. Create and independently drill replacement recovery
            identities immediately. A compromised credential can always be revoked.
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
          {messageError ? (
            <ShieldAlert className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <AlertTitle>
            {messageError ? 'Action could not complete' : 'Authentication update'}
          </AlertTitle>
          <AlertDescription className="break-words">{message}</AlertDescription>
        </Alert>
      )}
      <AuthenticationNavigationGuard />
      <AuthenticationDraftCoordinator />
      <DetailTabs
        syncWithUrl
        urlParamName="authTab"
        activeTab={activeTab}
        onTabChange={value => setActiveTab(value as AuthenticationSection)}
        layout="auto"
        tabs={[
          ...(!emergencyOnly
            ? [
                { id: 'overview', label: 'Overview', icon: <Shield className="h-4 w-4" /> },
                {
                  id: 'connection',
                  label: 'Identity Provider',
                  icon: <Globe className="h-4 w-4" />,
                },
                {
                  id: 'access',
                  label: 'Access & provisioning',
                  icon: <Users className="h-4 w-4" />,
                },
                {
                  id: 'policy',
                  label: 'Sessions & Policies',
                  icon: <Settings2 className="h-4 w-4" />,
                },
              ]
            : []),
          { id: 'emergency', label: 'Emergency Recovery', icon: <KeyRound className="h-4 w-4" /> },
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
                  onNavigate={setActiveTab}
                  className={sectionClass}
                  providerLabel={
                    data.activeProvider
                      ? providerDefinitions[data.activeProvider.providerType].label
                      : ''
                  }
                />
              </DetailTabContent>
            )}
            {activeTab === 'connection' && (
              <DetailTabContent value="connection">
                <AuthenticationProviderWorkspace />
              </DetailTabContent>
            )}
            {activeTab === 'access' && (
              <DetailTabContent value="access">
                <AuthenticationAccessWorkspace />
              </DetailTabContent>
            )}
            {activeTab === 'policy' && (
              <DetailTabContent value="policy">
                <AuthenticationPolicyWorkspace />
              </DetailTabContent>
            )}
          </>
        )}
        {activeTab === 'emergency' && (
          <DetailTabContent value="emergency">
            <AuthenticationRecoveryWorkspace />
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
                return perform(async () => {
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
