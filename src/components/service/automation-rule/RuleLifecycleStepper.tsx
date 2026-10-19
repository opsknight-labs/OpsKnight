import Link from 'next/link';
import { CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import { readinessPresentation } from './rule-presentation';

type StepState = 'done' | 'current' | 'todo' | 'blocked';

type Step = {
  key: string;
  title: string;
  state: StepState;
  detail: string;
  note?: string;
  link?: { href: string; label: string };
};

export type RuleLifecycleInput = {
  serviceId: string;
  version: number | null;
  readinessState: BindingReadiness['state'];
  detached: boolean;
  enabled: boolean;
  mode: string;
  eligibleAgents: number | null;
  certifiedAgents: number;
  executionCount: number;
};

export function ruleLifecycleSteps(input: RuleLifecycleInput): Step[] {
  const configured = input.version !== null;
  const valid = input.readinessState === 'CONFIGURATION_VALID';
  const active = input.enabled && !input.detached;
  return [
    {
      key: 'configure',
      title: 'Configure',
      state: configured ? 'done' : 'current',
      detail: configured ? `Version ${input.version} selected` : 'Select a published version',
      link: { href: `/services/${input.serviceId}?tab=runbooks`, label: 'Manage service rules' },
    },
    {
      key: 'validate',
      title: 'Validate',
      state: input.detached
        ? 'todo'
        : valid
          ? 'done'
          : input.readinessState === 'BLOCKED' || input.readinessState === 'UNKNOWN'
            ? 'blocked'
            : configured
              ? 'current'
              : 'todo',
      detail: readinessPresentation(input.readinessState).label,
      link: { href: '#checks', label: 'Review configuration and policy checks' },
    },
    {
      key: 'activate',
      title: 'Activate',
      state: input.detached ? 'blocked' : active ? 'done' : valid ? 'current' : 'todo',
      detail: input.detached
        ? 'Detached; activation unavailable'
        : input.enabled
          ? 'Rule enabled'
          : 'Rule paused',
      note:
        input.mode === 'AUTOMATIC' && input.eligibleAgents !== null
          ? `${input.certifiedAgents} / ${input.eligibleAgents} Agents have fresh accepted policy evidence. ${Math.max(0, input.eligibleAgents - input.certifiedAgents)} still require certification.`
          : undefined,
    },
    {
      key: 'monitor',
      title: 'Monitor',
      state: active ? (input.executionCount > 0 ? 'done' : 'current') : 'todo',
      detail: `${input.executionCount} recent executions`,
      link: { href: '#history', label: 'Inspect outcomes and evidence' },
    },
  ];
}

const ICONS = {
  done: {
    icon: CheckCircle2,
    badgeClass:
      'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-emerald-500/30 border border-emerald-500/20',
    label: 'Done',
  },
  current: {
    icon: CircleDot,
    badgeClass: 'text-primary bg-primary/10 ring-primary/30 border border-primary/20',
    label: 'Current step',
  },
  todo: {
    icon: Circle,
    badgeClass: 'text-muted-foreground/50 bg-muted/60 ring-border border border-border/60',
    label: 'Not started',
  },
  blocked: {
    icon: XCircle,
    badgeClass:
      'text-rose-600 dark:text-rose-400 bg-rose-500/10 ring-rose-500/30 border border-rose-500/20',
    label: 'Blocked',
  },
} as const;

export function RuleLifecycleStepper(props: RuleLifecycleInput) {
  const steps = ruleLifecycleSteps(props);
  return (
    <ol aria-label="Rule lifecycle" className="relative space-y-0">
      {steps.map((step, index) => {
        const { icon: Icon, badgeClass, label } = ICONS[step.state];
        const isLast = index === steps.length - 1;
        return (
          <li
            key={step.key}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={cn('relative flex gap-3.5', !isLast && 'pb-4.5')}
          >
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[11px] top-6 -bottom-0 w-0.5 rounded-full',
                  step.state === 'done' ? 'bg-emerald-500/40' : 'bg-border/70 dark:bg-border/50'
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-background shadow-2xs z-10 transition-colors',
                badgeClass
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
            </span>
            <div className="min-w-0 space-y-0.5 text-xs pt-0.5">
              <p className="flex items-center gap-2 font-bold text-foreground">
                {step.title}
                <span className="sr-only">({label})</span>
              </p>
              <p className="text-muted-foreground/90 leading-relaxed">{step.detail}</p>
              {step.note && (
                <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                  {step.note}
                </p>
              )}
              {step.link && (
                <div className="pt-0.5">
                  {step.link.href.startsWith('#') ? (
                    <a
                      href={step.link.href}
                      className="font-semibold text-primary hover:underline underline-offset-2"
                    >
                      {step.link.label}
                    </a>
                  ) : (
                    <Link
                      href={step.link.href}
                      className="font-semibold text-primary hover:underline underline-offset-2"
                    >
                      {step.link.label}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
