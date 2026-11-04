'use client';

import { Check, Lock, AlertTriangle } from 'lucide-react';
import type { AuthenticationSection } from '@/lib/auth-control/dashboard';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { AUTH_TAB_NAMES, SETUP_TABS } from './setup-steps';

type StepState = 'done' | 'current' | 'blocked' | 'upcoming';
type Step = {
  id: string;
  label: string;
  hint: string;
  target: AuthenticationSection;
  state: StepState;
};

/**
 * Compact, always-visible progress for setting up single sign-on. It reflects server-derived
 * state (saved configuration, administrator test, emergency readiness, activation) and links
 * each step to the part of the console where it is done.
 */
export default function AuthenticationWorkflowSteps() {
  const { data, revisionId, draftDirty, configuration, mode, activeTab, setActiveTab } =
    useAuthenticationWorkspace();
  if (!SETUP_TABS.includes(activeTab)) return null;

  const selected = data.revisions.find(revision => revision.id === revisionId);
  const configured = Boolean(configuration.issuer && configuration.clientId);
  const saved = configured && Boolean(selected?.discoveryVerifiedAt) && !draftDirty;
  const verified = saved && selected?.verification.state === 'valid';
  const recoveryReady = data.verifiedEmergencyAccounts >= 2;
  const needsRecovery = mode === 'SSO_REQUIRED' && !recoveryReady;
  const activated =
    !draftDirty &&
    Boolean(selected) &&
    selected?.id === data.activeRevisionId &&
    data.mode !== 'PASSWORD_ONLY';

  const raw: Array<Omit<Step, 'state'> & { done: boolean; blocked?: boolean }> = [
    {
      id: 'connect',
      label: AUTH_TAB_NAMES.connection,
      hint: draftDirty ? 'Unsaved changes' : 'Provider, client and callbacks',
      target: 'connection',
      done: saved,
    },
    {
      id: 'access',
      label: AUTH_TAB_NAMES.access,
      hint: 'New and existing accounts',
      target: 'access',
      done: saved,
    },
    {
      id: 'roles',
      label: AUTH_TAB_NAMES.roles,
      hint: configuration.roleMapping.length
        ? `${configuration.roleMapping.length} role rule${configuration.roleMapping.length === 1 ? '' : 's'}`
        : 'Optional',
      target: 'roles',
      done: saved,
    },
    {
      id: 'test',
      label: 'Test your sign-in',
      hint: 'A real sign-in, valid 7 days',
      target: 'policy',
      done: verified,
    },
    {
      id: 'activate',
      label: 'Turn on SSO',
      hint: needsRecovery
        ? 'Required mode needs 2 recovery identities'
        : 'Nothing changes before this',
      target: needsRecovery ? 'emergency' : 'policy',
      done: activated,
      blocked: needsRecovery,
    },
  ];
  // Activation completes the whole journey; otherwise steps complete in order.
  let reachedCurrent = false;
  const steps: Step[] = raw.map(step => {
    if (activated || (step.done && !reachedCurrent)) return { ...step, state: 'done' };
    if (!reachedCurrent) {
      reachedCurrent = true;
      return { ...step, state: step.blocked ? 'blocked' : 'current' };
    }
    return { ...step, state: step.blocked ? 'blocked' : 'upcoming' };
  });
  const current = steps.find(step => step.state === 'current' || step.state === 'blocked');

  return (
    <nav
      aria-label="Single sign-on setup progress"
      className="min-w-0 rounded-xl border bg-card p-3 sm:p-4 shadow-xs"
    >
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold text-foreground">
          {activated
            ? 'Selected configuration is active'
            : current
              ? `Next: ${current.label}`
              : 'Ready to activate'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          The active configuration stays unchanged until activation.
        </p>
      </div>
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {steps.map((step, index) => (
          <li key={step.id} className="min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab(step.target)}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className="group flex w-full min-w-0 flex-col items-start gap-1.5 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={`h-1 w-full rounded-full ${
                  step.state === 'done'
                    ? 'bg-emerald-500'
                    : step.state === 'current'
                      ? 'bg-primary'
                      : step.state === 'blocked'
                        ? 'bg-amber-500'
                        : 'bg-muted'
                }`}
                aria-hidden
              />
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    step.state === 'done'
                      ? 'bg-emerald-500 text-white'
                      : step.state === 'current'
                        ? 'bg-primary text-primary-foreground'
                        : step.state === 'blocked'
                          ? 'bg-amber-500 text-white'
                          : 'bg-muted text-muted-foreground'
                  }`}
                  aria-hidden
                >
                  {step.state === 'done' ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : step.state === 'blocked' ? (
                    <AlertTriangle className="h-2.5 w-2.5" />
                  ) : step.state === 'upcoming' && index === 4 ? (
                    <Lock className="h-2.5 w-2.5" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`hidden truncate text-[11px] font-medium md:inline ${
                    step.state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {step.label}
                </span>
              </span>
              <span className="sr-only">
                {`Step ${index + 1}: ${step.label} — ${
                  step.state === 'done'
                    ? 'complete'
                    : step.state === 'current'
                      ? 'current step'
                      : step.state === 'blocked'
                        ? 'blocked'
                        : 'not started'
                }. ${step.hint}.`}
              </span>
              <span
                className="hidden text-[10px] leading-snug text-muted-foreground lg:block"
                aria-hidden
              >
                {step.hint}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
