'use client';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import type { authenticationDashboard, AuthenticationSection } from '@/lib/auth-control/dashboard';
import { readableDuration } from './authentication/AuthenticationSessionPolicyForm';

export default function AuthenticationOverview({
  data,
  className,
  providerLabel,
  onNavigate,
}: {
  data: Awaited<ReturnType<typeof authenticationDashboard>>;
  className: string;
  providerLabel: string;
  onNavigate: (section: AuthenticationSection) => void;
}) {
  const configured = Boolean(data.activeProvider) || data.providerCompatibilityWarning;
  const active = data.revisions.find(revision => revision.id === data.activeRevisionId);
  const candidate = data.revisions.find(revision => !revision.activatedAt);
  const discovery = Boolean(candidate?.discoveryVerifiedAt);
  const verified = Boolean(candidate?.testedAt); // Historical evidence; activation rechecks freshness on the server.
  const next = data.originConflict
    ? {
        label: 'Review canonical URL conflict',
        target: 'emergency',
        reason: 'Align trusted public URLs before changing authentication.',
      }
    : data.recoveryDegradedAt ||
        (data.mode === 'SSO_REQUIRED' && data.verifiedEmergencyAccounts < 2)
      ? {
          label: 'Restore recovery readiness',
          target: 'emergency',
          reason: 'Keep two independently verified recovery identities available.',
        }
      : data.failedEmailAlertCount > 0
        ? {
            label: 'Investigate security notifications',
            target: 'diagnostics',
            reason: 'Failed security emails need operator attention.',
          }
        : configured
          ? {
              label: 'Manage identity provider',
              target: 'connection',
              reason: 'Review the active connection or prepare a tested replacement.',
            }
          : !discovery
            ? {
                label: 'Continue setup',
                target: 'connection',
                reason: 'Choose a provider, register both callbacks and stage its credentials.',
              }
            : !verified
              ? {
                  label: 'Test administrator sign-in',
                  target: 'connection',
                  reason:
                    'Discovery succeeded. Verify an existing administrator through the real provider.',
                }
              : data.verifiedEmergencyAccounts < 2
                ? {
                    label: 'Prepare emergency recovery',
                    target: 'emergency',
                    reason: 'Create and independently drill two recovery identities.',
                  }
                : {
                    label: 'Review and activate',
                    target: 'policy',
                    reason:
                      'Review access, session policy and enforcement impact before activation.',
                  };
  const steps = [
    {
      title: 'Choose a provider',
      target: 'connection',
      state: configured ? 'Active' : candidate ? 'Ready to test' : 'Not started',
    },
    {
      title: 'Configure credentials and callbacks',
      target: 'connection',
      state: configured ? 'Active' : discovery ? 'Verified' : 'Needs attention',
    },
    {
      title: 'Verify administrator sign-in',
      target: 'connection',
      state: configured
        ? 'Active'
        : verified
          ? 'Verified'
          : discovery
            ? 'Ready to test'
            : 'Not started',
    },
    {
      title: 'Review access and recovery',
      target: 'emergency',
      state: data.verifiedEmergencyAccounts >= 2 ? 'Verified' : 'Needs attention',
    },
    {
      title: 'Review impact and activate',
      target: 'policy',
      state: configured
        ? 'Active'
        : verified && data.verifiedEmergencyAccounts >= 2
          ? 'Ready to test'
          : 'Not started',
    },
  ];
  return (
    <section id="authentication-0" className={className} aria-labelledby="auth-overview-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="auth-overview-title" className="text-lg font-semibold">
            {configured ? 'Authentication overview' : 'Configure Enterprise SSO'}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {configured
              ? 'Current configuration, recorded verification and recovery readiness.'
              : 'Prepare a tested sign-in path before changing access. Draft changes remain inactive until activation.'}
          </p>
        </div>
        <Button onClick={() => onNavigate(next.target as AuthenticationSection)}>
          {next.label}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{next.reason}</p>
      <dl className="grid gap-x-8 gap-y-5 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-3 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-2 [&_dd]:text-sm [&_dd]:font-medium">
        <div>
          <dt>Authentication mode</dt>
          <dd>{data.mode.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt>
            {data.mode === 'PASSWORD_ONLY'
              ? 'Stored identity provider'
              : 'Active identity provider'}
          </dt>
          <dd>
            {data.activeProvider
              ? providerLabel
              : data.providerCompatibilityWarning
                ? 'Historical configuration · review required'
                : 'Not configured'}
          </dd>
        </div>
        <div>
          <dt>Independent recovery</dt>
          <dd>{data.verifiedEmergencyAccounts} current successful drills</dd>
        </div>
        <div>
          <dt>Last recorded administrator verification</dt>
          <dd>
            {active?.testedAt
              ? new Date(active.testedAt).toLocaleString()
              : 'No verified active configuration recorded'}
          </dd>
        </div>
        <div>
          <dt>Effective maximum session lifetime</dt>
          <dd>{readableDuration(data.effectiveSessionPolicy?.maximumAgeSeconds)}</dd>
        </div>
        <div>
          <dt>Effective idle timeout</dt>
          <dd>{readableDuration(data.effectiveSessionPolicy?.idleTimeoutSeconds)}</dd>
        </div>
        {data.activeProvider && (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt>Configured issuer</dt>
            <dd className="[overflow-wrap:anywhere]">{data.activeProvider.issuer}</dd>
          </div>
        )}
      </dl>
      {!configured && (
        <ol aria-label="SSO setup progress" className="divide-y divide-border">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 py-4">
              {step.state === 'Verified' || step.state === 'Active' ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                  aria-hidden="true"
                />
              ) : step.state === 'Needs attention' ? (
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {index + 1}. {step.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{step.state}</p>
              </div>
              <Button
                variant="link"
                size="sm"
                onClick={() => onNavigate(step.target as AuthenticationSection)}
              >
                Review<span className="sr-only"> {step.title}</span>
              </Button>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Your original administrator and incident ownership are preserved. Emergency identities are
        separate from normal users. Recorded checks are evidence of their timestamp, not a live IdP
        availability guarantee.
      </p>
    </section>
  );
}
