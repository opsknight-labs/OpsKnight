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
  done: { icon: CheckCircle2, className: 'text-emerald-500', label: 'Done' },
  current: { icon: CircleDot, className: 'text-primary', label: 'Current step' },
  todo: { icon: Circle, className: 'text-muted-foreground/50', label: 'Not started' },
  blocked: { icon: XCircle, className: 'text-rose-500', label: 'Blocked' },
} as const;

export function RuleLifecycleStepper(props: RuleLifecycleInput) {
  const steps = ruleLifecycleSteps(props);
  return (
    <ol aria-label="Rule lifecycle" className="relative space-y-4">
      {steps.map((step, index) => {
        const { icon: Icon, className, label } = ICONS[step.state];
        return (
          <li
            key={step.key}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="relative flex gap-3"
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[9px] top-6 h-[calc(100%-0.5rem)] w-px',
                  step.state === 'done' ? 'bg-emerald-500/40' : 'bg-border'
                )}
              />
            )}
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0 bg-card', className)} aria-hidden />
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {step.title}
                <span className="sr-only">({label})</span>
              </p>
              <p className="text-muted-foreground">{step.detail}</p>
              {step.note && <p className="text-xs text-muted-foreground">{step.note}</p>}
              {step.link &&
                (step.link.href.startsWith('#') ? (
                  <a href={step.link.href} className="text-xs text-primary hover:underline">
                    {step.link.label}
                  </a>
                ) : (
                  <Link href={step.link.href} className="text-xs text-primary hover:underline">
                    {step.link.label}
                  </Link>
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
