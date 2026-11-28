'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import type { IntelligenceActionState } from '@/app/(app)/settings/intelligence/actions';
import { addAiModelAction } from '@/app/(app)/settings/intelligence/setup-actions';
import RecommendedPresetButton from '@/components/settings/RecommendedPresetButton';
import { ActionMessage, fieldClass, labelClass } from '@/components/settings/form-kit';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import {
  setupRevisions,
  setupStage,
  type SetupState,
} from '@/lib/intelligence/settings/setup-contract';

export interface SetupCounts {
  services: number;
  integrations: number;
  incidents: number;
}

const STEPS = [
  { id: 'watch', title: 'Start watching' },
  { id: 'alerts', title: 'Connect your alerts' },
  { id: 'ai', title: 'Add an AI model' },
  { id: 'done', title: "You're set" },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const PROVIDERS = [
  { value: 'ANTHROPIC', title: 'Anthropic', hint: 'Claude models' },
  { value: 'OPENAI', title: 'OpenAI', hint: 'GPT models' },
  { value: 'GOOGLE', title: 'Google', hint: 'Gemini models' },
] as const;

const cardClass =
  'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring';

/**
 * The guided start: four short steps, each skippable, in the order that gets a newcomer to value without
 * changing anything for their team. Step state is derived from the saved settings, so a reload, or two
 * admins, never disagree about what is done.
 */
export default function IntelligenceSetupGuide({
  state,
  counts,
  canManage,
}: {
  state: SetupState;
  counts: SetupCounts;
  canManage: boolean;
}) {
  const stage = setupStage(state);
  const done: Record<StepId, boolean> = {
    watch: stage !== 'off',
    alerts: counts.services > 0 && counts.incidents > 0,
    ai: state.aiConfigured,
    done: false,
  };
  const firstOpen = STEPS.find(step => step.id !== 'done' && !done[step.id])?.id ?? 'done';
  const [current, setCurrent] = useState<StepId>(firstOpen);
  const index = STEPS.findIndex(step => step.id === current);
  const next = () => setCurrent(STEPS[Math.min(index + 1, STEPS.length - 1)]!.id);

  return (
    <div className="space-y-6">
      <ol aria-label="Setup steps" className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((step, position) => {
          const isCurrent = step.id === current;
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => setCurrent(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  isCurrent ? 'border-primary bg-primary/5 font-medium' : 'border-border bg-card'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    done[step.id]
                      ? cn(toneClasses('ok').solid, 'text-white')
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {done[step.id] ? <Check className="h-3.5 w-3.5" /> : position + 1}
                </span>
                <span>
                  {step.title}
                  {done[step.id] && <span className="sr-only"> (done)</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {!canManage && (
        <p role="note" className="rounded-md border border-border bg-muted p-3 text-sm">
          You can look around, but only an administrator can change these settings. Ask one to run
          this guide.
        </p>
      )}

      <section aria-labelledby="step-title" className="rounded-lg border border-border bg-card p-5">
        {current === 'watch' && (
          <Step
            title="Start watching"
            lead="Intelligence learns from your incidents first. Nothing changes for your team until you decide."
            done={done.watch}
            onNext={next}
          >
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Nobody&rsquo;s paging changes, and no alert is held back.</li>
              <li>Your team sees nothing new yet.</li>
              <li>
                It records which pages it <em>could</em> have prevented, so you can check it first.
              </li>
            </ul>
            {canManage && !done.watch && (
              <RecommendedPresetButton
                revisions={setupRevisions(state)}
                label="Start watching"
                pendingLabel="Starting…"
              />
            )}
            {done.watch && (
              <p className="text-sm font-medium">Watching. You can change this any time.</p>
            )}
          </Step>
        )}

        {current === 'alerts' && (
          <Step
            title="Connect your alerts"
            lead="Intelligence needs incidents to learn from."
            done={done.alerts}
            onNext={next}
          >
            <p className="text-sm">
              {counts.incidents > 0
                ? `Learning from ${counts.services} ${counts.services === 1 ? 'service' : 'services'} and ${counts.incidents.toLocaleString()} ${counts.incidents === 1 ? 'incident' : 'incidents'}.`
                : counts.services > 0
                  ? 'You have services but no incidents yet. Once an alert arrives, it starts learning.'
                  : 'No services yet. Add a service and connect a monitoring tool to start.'}
            </p>
            {(counts.services === 0 || counts.integrations === 0) && (
              <Button asChild variant="outline" className="min-h-11 sm:min-h-10">
                <Link href="/services">Add a service or integration</Link>
              </Button>
            )}
          </Step>
        )}

        {current === 'ai' && (
          <Step
            title="Add an AI model"
            lead="Optional. Squire already answers from your incident data. A model lets it write summaries and answer in full sentences."
            done={done.ai}
            onNext={next}
          >
            {done.ai ? (
              <p className="text-sm font-medium">An AI model is connected.</p>
            ) : canManage ? (
              <AiModelForm />
            ) : null}
          </Step>
        )}

        {current === 'done' && (
          <Step title="You're set" lead="Here is what happens next." done={false}>
            <ul className="space-y-2 text-sm">
              <Summary on={done.watch}>Intelligence is watching your incidents.</Summary>
              <Summary on={stage === 'showing' || stage === 'acting'}>
                Your team sees suggestions. (Not yet: you switch this on after a week.)
              </Summary>
              <Summary on={done.ai}>An AI model is connected.</Summary>
            </ul>
            <p className="text-sm text-muted-foreground">
              Check back in about a week. The Intelligence overview will show what it learned and
              offer a one-click switch on.
            </p>
            <Button asChild className="min-h-11 sm:min-h-10">
              <Link href="/intelligence">Go to Intelligence</Link>
            </Button>
          </Step>
        )}
      </section>
    </div>
  );
}

function Step({
  title,
  lead,
  done,
  onNext,
  nextLabel,
  children,
}: {
  title: string;
  lead: string;
  done: boolean;
  onNext?: () => void;
  nextLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 id="step-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm font-normal text-muted-foreground">{lead}</p>
      </div>
      {children}
      {onNext && (
        <div className="pt-1">
          <Button
            type="button"
            variant={done ? 'default' : 'ghost'}
            onClick={onNext}
            className="min-h-11 sm:min-h-10"
          >
            {nextLabel ?? (done ? 'Continue' : 'Skip for now')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Summary({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check
        className={cn('mt-0.5 h-4 w-4 shrink-0', on ? toneClasses('ok').text : 'opacity-30')}
        aria-hidden="true"
      />
      <span>
        {children}
        <span className="sr-only">{on ? ' (done)' : ' (not yet)'}</span>
      </span>
    </li>
  );
}

const initial: IntelligenceActionState = { message: '', ok: true };

function AiModelForm() {
  const [state, action, pending] = useActionState(addAiModelAction, initial);
  const [kind, setKind] = useState<(typeof PROVIDERS)[number]['value']>('ANTHROPIC');
  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className={labelClass}>Provider</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {PROVIDERS.map(provider => (
            <label key={provider.value} className={cardClass}>
              <input
                type="radio"
                name="kind"
                value={provider.value}
                checked={kind === provider.value}
                onChange={() => setKind(provider.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold">{provider.title}</span>
                <span className="block text-sm text-muted-foreground">{provider.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="max-w-md space-y-1">
        <label htmlFor="setup-api-key" className={labelClass}>
          API key
        </label>
        <input
          id="setup-api-key"
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          className={fieldClass}
        />
        <p className="text-xs font-normal text-muted-foreground">
          Stored encrypted and never shown again. You pay your provider directly; a daily limit is
          set for you.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className={labelClass}>What may the model read?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={cardClass}>
            <input type="radio" name="incidentText" value="text" defaultChecked className="mt-1" />
            <span>
              <span className="block text-sm font-semibold">Incident text and names</span>
              <span className="block text-sm text-muted-foreground">
                Titles, notes and who wrote them. Needed for summaries and drafts.
              </span>
            </span>
          </label>
          <label className={cardClass}>
            <input type="radio" name="incidentText" value="titles" className="mt-1" />
            <span>
              <span className="block text-sm font-semibold">Titles and service names only</span>
              <span className="block text-sm text-muted-foreground">
                More private. Summaries and drafts will not be available.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="min-h-11 sm:min-h-10">
          {pending ? 'Testing…' : 'Add and test'}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
