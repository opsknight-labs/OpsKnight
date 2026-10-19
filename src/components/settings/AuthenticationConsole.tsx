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
  Timer,
} from 'lucide-react';
import type { AuthenticationSection } from '@/lib/auth-control/dashboard';
import { useRateLimitCountdown, formatRemainingTime } from './authentication/useRateLimitCountdown';
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
import AuthenticationWorkflowSteps from './authentication/AuthenticationWorkflowSteps';

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
    setMessage,
    router,
    sectionClass,
    emergencyOnly,
  } = useAuthenticationWorkspace();
  const {
    displayMessage: liveMessage,
    isCooldown,
    remainingSeconds,
  } = useRateLimitCountdown(message);
  return (
    <div className="min-w-0 space-y-6">
      {/* Main SSO & Authentication Card Header */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-foreground">
                  Authentication Control Center
                </h3>
                <Badge
                  variant={data.mode === 'SSO_REQUIRED' ? 'success' : 'neutral'}
                  className="text-xs font-semibold"
                >
                  {data.mode.replaceAll('_', ' ')}
                </Badge>
                {data.activeProvider && (
                  <Badge
                    variant="outline"
                    className="text-xs border-primary/20 bg-primary/5 text-primary"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />
                    {providerDefinitions[data.activeProvider.providerType]?.label ?? 'OIDC Active'}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Secure sign-in, tested changes, independent recovery
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
            <Badge
              variant="outline"
              className={
                data.verifiedEmergencyAccounts >= 2
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs'
              }
            >
              <KeyRound className="h-3 w-3 mr-1" />
              {data.verifiedEmergencyAccounts} Recovery{' '}
              {data.verifiedEmergencyAccounts === 1 ? 'Drill' : 'Drills'}
            </Badge>
          </div>
        </div>
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
            isCooldown ? (
              <Timer className="h-4 w-4 animate-pulse" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <AlertTitle className="flex items-center gap-2 flex-wrap">
            <span>{messageError ? 'Action could not complete' : 'Authentication update'}</span>
            {isCooldown && remainingSeconds > 0 && (
              <Badge
                variant="outline"
                className="border-destructive/30 bg-destructive/10 text-destructive text-[11px] font-semibold py-0"
              >
                <Timer className="h-3 w-3 mr-1" />
                Retry in {formatRemainingTime(remainingSeconds)}
              </Badge>
            )}
          </AlertTitle>
          <AlertDescription className="break-words">{liveMessage}</AlertDescription>
        </Alert>
      )}
      <AuthenticationNavigationGuard />
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
                  badge: data.activeProvider ? (
                    <span
                      aria-hidden="true"
                      className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400"
                    >
                      Active
                    </span>
                  ) : undefined,
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
          {
            id: 'emergency',
            label: 'Emergency Recovery',
            icon: <KeyRound className="h-4 w-4" />,
            badge:
              data.verifiedEmergencyAccounts < 2 ? (
                <span
                  aria-hidden="true"
                  className="rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400"
                >
                  Needs Drill
                </span>
              ) : undefined,
          },
          {
            id: 'diagnostics',
            label: 'Diagnostics',
            icon: <Activity className="h-4 w-4" />,
            badge:
              data.failedEmailAlertCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="rounded-full border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700 dark:text-rose-400"
                >
                  {data.failedEmailAlertCount} alert{data.failedEmailAlertCount > 1 ? 's' : ''}
                </span>
              ) : undefined,
          },
        ]}
      >
        <AuthenticationWorkflowSteps />
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
                await refresh();
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
                  setMessage('Security alert delivery retry initiated.');
                })
              }
              onRevoke={async sessionId => {
                let redirecting = false;
                const success = await perform(async () => {
                  const result = await authenticationRequest<{ revokedCurrentSession: boolean }>({
                    action: 'revokeSession',
                    sessionId,
                  });
                  if (result.revokedCurrentSession) {
                    redirecting = true;
                    setMessage('Your session was revoked successfully. Sign in again to continue.');
                    router.replace('/login?sessionRevoked=1');
                    return;
                  }
                  setMessage('Session revoked successfully.');
                  await refresh();
                });
                return success && redirecting ? 'redirecting' : success;
              }}
            />
          </DetailTabContent>
        )}
      </DetailTabs>
      <AuthenticationDraftCoordinator />
    </div>
  );
}
