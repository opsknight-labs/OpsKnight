'use client';
import { AUTH_TAB_LABELS, AUTH_TAB_NAMES } from './authentication/setup-steps';
import {
  CheckCircle2,
  AlertTriangle,
  Shield,
  Globe,
  KeyRound,
  Clock,
  Link2,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
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
  // The live proof state, not merely that a test once happened.
  const verified = candidate?.verification.state === 'valid';
  const next = data.originConflict
    ? {
        label: 'Fix the application address',
        target: 'policy',
        reason:
          'OpsKnight is reachable at more than one address. Make NEXTAUTH_URL, NEXT_PUBLIC_APP_URL and the App URL in System settings identical.',
      }
    : data.recoveryDegradedAt ||
        (data.mode === 'SSO_REQUIRED' && data.verifiedEmergencyAccounts < 2)
      ? {
          label: 'Restore recovery readiness',
          target: 'emergency',
          reason: 'SSO Required needs two independently tested recovery identities.',
        }
      : data.linkingRequestCount > 0
        ? {
            label: `Review ${data.linkingRequestCount} SSO access request${data.linkingRequestCount === 1 ? '' : 's'}`,
            target: 'access',
            reason: 'People tried to sign in with SSO and are waiting for your approval.',
          }
        : data.failedEmailAlertCount > 0
          ? {
              label: 'Investigate security notifications',
              target: 'diagnostics',
              reason: 'Failed security emails need operator attention.',
            }
          : configured
            ? {
                label: 'Manage single sign-on',
                target: 'connection',
                reason: 'Review the active connection or prepare and test a replacement.',
              }
            : !discovery
              ? {
                  label: 'Connect your identity provider',
                  target: 'connection',
                  reason: 'Choose a provider, copy two callback URLs into it, and save.',
                }
              : !verified
                ? {
                    label: 'Test your own sign-in',
                    target: 'policy',
                    reason: 'Your provider responded correctly. Sign in once to prove it works.',
                  }
                : {
                    label: 'Turn on single sign-on',
                    target: 'policy',
                    reason: 'Review what will change, then turn it on. Start with SSO Optional.',
                  };
  const steps = [
    {
      title: AUTH_TAB_NAMES.connection,
      target: 'connection',
      state: configured ? 'Active' : discovery ? 'Verified' : 'Not started',
    },
    {
      title: AUTH_TAB_NAMES.access,
      target: 'access',
      state: data.linkingRequestCount > 0 ? 'Needs attention' : configured ? 'Active' : 'Optional',
    },
    {
      title: AUTH_TAB_NAMES.roles,
      target: 'roles',
      state: configured ? 'Active' : 'Optional',
    },
    {
      title: 'Test your sign-in',
      target: 'policy',
      state: configured
        ? 'Active'
        : verified
          ? 'Verified'
          : discovery
            ? 'Ready to test'
            : 'Not started',
    },
    {
      title:
        data.mode === 'SSO_REQUIRED'
          ? 'Emergency recovery (required)'
          : 'Emergency recovery (only for SSO Required)',
      target: 'emergency',
      state:
        data.verifiedEmergencyAccounts >= 2
          ? 'Verified'
          : data.mode === 'SSO_REQUIRED'
            ? 'Needs attention'
            : 'Optional',
    },
  ];
  return (
    <section id="authentication-0" className={className} aria-labelledby="auth-overview-title">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </div>
            <h2 id="auth-overview-title" className="text-base sm:text-lg font-bold text-foreground">
              {configured ? 'Authentication overview' : 'Configure Enterprise SSO'}
            </h2>
            <Badge
              variant={data.mode === 'SSO_REQUIRED' ? 'success' : 'neutral'}
              className="text-xs"
            >
              {data.mode.replaceAll('_', ' ')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
            {configured
              ? 'Current configuration, recorded verification and recovery readiness.'
              : 'Prepare a tested sign-in path before changing access. Draft changes remain inactive until activation.'}
          </p>
        </div>
        <Button onClick={() => onNavigate(next.target as AuthenticationSection)} size="sm">
          {next.label}
        </Button>
      </header>

      {/* Recommended Action Card */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Next Step
            </span>
          </div>
          <p className="text-xs sm:text-sm text-foreground font-medium leading-relaxed">
            {next.reason}
          </p>
        </div>
        <Button
          onClick={() => onNavigate(next.target as AuthenticationSection)}
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 h-8 text-xs border-primary/30 hover:bg-primary/10"
        >
          <span>{next.label}</span>
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>

      {/* Grid of Metric/Stat Cards */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Active Configuration Summary
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-primary" />
              Authentication mode
            </dt>
            <dd className="text-sm font-bold text-foreground">
              <Badge
                variant={data.mode === 'SSO_REQUIRED' ? 'success' : 'neutral'}
                className="text-xs"
              >
                {data.mode.replaceAll('_', ' ')}
              </Badge>
            </dd>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-primary" />
              {data.mode === 'PASSWORD_ONLY'
                ? 'Stored identity provider'
                : 'Active identity provider'}
            </dt>
            <dd className="text-sm font-bold text-foreground">
              {data.activeProvider
                ? providerLabel
                : data.providerCompatibilityWarning
                  ? 'Historical configuration · review required'
                  : 'Not configured'}
            </dd>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              Independent recovery
            </dt>
            <dd className="text-sm font-bold text-foreground">
              {data.verifiedEmergencyAccounts} current successful drills
            </dd>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              Last recorded administrator verification
            </dt>
            <dd className="text-xs font-medium text-foreground">
              {active?.testedAt
                ? new Date(active.testedAt).toLocaleString()
                : 'No verified active configuration recorded'}
            </dd>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Effective maximum session lifetime
            </dt>
            <dd className="text-sm font-bold text-foreground">
              {readableDuration(data.effectiveSessionPolicy?.maximumAgeSeconds)}
            </dd>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Effective idle timeout
            </dt>
            <dd className="text-sm font-bold text-foreground">
              {readableDuration(data.effectiveSessionPolicy?.idleTimeoutSeconds)}
            </dd>
          </div>
          {data.activeProvider && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 transition-all hover:bg-muted/40 sm:col-span-2 lg:col-span-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-primary" />
                Configured issuer
              </dt>
              <dd className="text-xs font-mono font-medium text-foreground [overflow-wrap:anywhere]">
                {data.activeProvider.issuer}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Configuration Roadmap */}
      {!configured && (
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Configuration Roadmap
          </h3>
          <ol aria-label="SSO setup progress" className="space-y-2">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex items-center justify-between gap-3 p-3.5 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                      step.state === 'Verified' || step.state === 'Active'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : step.state === 'Needs attention'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.state === 'Verified' || step.state === 'Active' ? (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    ) : step.state === 'Needs attention' ? (
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{step.title}</p>
                    <p className="text-xs text-muted-foreground">{step.state}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={
                      step.state === 'Verified' || step.state === 'Active'
                        ? 'success'
                        : step.state === 'Needs attention'
                          ? 'outline'
                          : 'neutral'
                    }
                    className="text-[10px]"
                  >
                    {step.state}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs gap-1"
                    onClick={() => onNavigate(step.target as AuthenticationSection)}
                  >
                    Review<span className="sr-only"> {step.title}</span>
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Interactive Workflow & Navigation Guide */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">How setup works</h3>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 text-xs leading-relaxed">
          {[
            {
              icon: <Globe className="h-3.5 w-3.5 text-primary" />,
              title: AUTH_TAB_LABELS.connection,
              body: 'Pick your provider, copy the two callback URLs into it, paste the client ID and secret, and save. Saving checks the connection.',
            },
            {
              icon: <Shield className="h-3.5 w-3.5 text-primary" />,
              title: AUTH_TAB_LABELS.access,
              body: 'Choose whether new people get an account automatically, which email domains are allowed, and approve existing accounts in bulk.',
            },
            {
              icon: <Sparkles className="h-3.5 w-3.5 text-primary" />,
              title: AUTH_TAB_LABELS.roles,
              body: 'Optional. Give people a role and teams from their identity provider groups, and try your rules with sample claims.',
            },
            {
              icon: <Clock className="h-3.5 w-3.5 text-primary" />,
              title: AUTH_TAB_LABELS.policy,
              body: 'Sign in once yourself, see exactly what will change, and turn on SSO Optional. Move to SSO Required after two emergency recovery identities are set up.',
            },
          ].map(item => (
            <div
              key={item.title}
              className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1"
            >
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                {item.icon}
                {item.title}
              </p>
              <p className="text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground pt-2">
        Your original administrator and incident ownership are preserved. Emergency identities are
        separate from normal users. Recorded checks are evidence of their timestamp, not a live IdP
        availability guarantee.
      </p>
    </section>
  );
}
