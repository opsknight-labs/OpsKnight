'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Play,
  Server,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { EmptyHint, Pill, SearchField } from '@/components/runbooks/ui/primitives';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import RunbookExecutionPreview from '@/components/runbooks/RunbookExecutionPreview';
import RunbookTargetSelect, {
  type RunbookTargetOptions,
} from '@/components/runbooks/RunbookTargetSelect';
import { InputFields, type InputDefinition } from '@/components/service/runbooks/rule-fields';
import {
  executeAdhocIncidentRunbookAction,
  loadAdhocIncidentRunbookAction,
  previewAdhocIncidentRunbookAction,
  searchAdhocIncidentRunbooksAction,
} from '../runbook-actions';

type RunbookOption = { id: string; name: string; description: string; version: number | null };
type LoadedRunbook = {
  id: string;
  name: string;
  description: string;
  version: number;
  inputs: InputDefinition[];
  requiresAgent: boolean;
  hasAgentWrite: boolean;
  hasWrite: boolean;
};

function planFields(form: HTMLFormElement | null) {
  if (!form) return [] as Array<[string, string]>;
  return [...new FormData(form).entries()]
    .filter(([key]) => key.startsWith('input:') || key === 'executionTarget')
    .map(([key, value]) => [key, String(value)] as [string, string]);
}

export default function AdhocRunbookLauncher({
  incidentId,
  initialRunbookId,
  label = 'Run another runbook',
}: {
  incidentId: string;
  initialRunbookId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<RunbookOption[]>([]);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [searching, startSearch] = useTransition();
  const [loading, startLoad] = useTransition();
  const [selected, setSelected] = useState<LoadedRunbook>();
  const [targets, setTargets] = useState<RunbookTargetOptions>({ agents: [], pools: [] });
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const previewed = useRef<Array<[string, string]>>([]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      startSearch(async () => {
        try {
          setOptions(await searchAdhocIncidentRunbooksAction(incidentId, query));
          setSearched(true);
          setSearchError('');
        } catch {
          setSearchError('Search unavailable. Try again.');
        }
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [incidentId, open, query]);

  const choose = (runbookId: string) => {
    setLoadError('');
    setSelected(undefined);
    startLoad(async () => {
      const result = await loadAdhocIncidentRunbookAction(incidentId, runbookId);
      if ('error' in result && result.error) return setLoadError(result.error);
      if ('runbook' in result && result.runbook) {
        setSelected(result.runbook);
        setTargets(result.targets);
        setRevision(value => value + 1);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          onClick={() => {
            if (initialRunbookId) choose(initialRunbookId);
          }}
          size="sm"
          className="gap-2 bg-foreground text-background hover:bg-foreground/90 font-medium shadow-2xs h-11 sm:h-8 text-xs shrink-0"
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden /> {label}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-3 border-b border-border bg-muted/20 px-4 pt-3.5 pb-2 pr-14 text-left">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background shadow-xs"
            >
              <Play className="h-4 w-4 fill-current" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <SheetTitle className="font-display text-base tracking-tight">
                Run a runbook
              </SheetTitle>
              <SheetDescription className="text-xs leading-relaxed">
                Any published runbook, against this incident. You see the exact plan before anything
                runs; step approvals and Agent policy still apply.
              </SheetDescription>
            </div>
          </div>
          <nav aria-label="Run steps" className="-mx-1 overflow-x-auto scrollbar-none">
            <ol className="flex items-center gap-0.5 px-1">
              {RUN_STEPS.map((step, index) => {
                const done = index === 0 && Boolean(selected);
                const current = selected ? index === 1 : index === 0;
                const reachable = index === 0 || Boolean(selected);
                return (
                  <li key={step.id} className="flex shrink-0 items-center">
                    {index > 0 && <span aria-hidden="true" className="mx-0.5 h-px w-3 bg-border" />}
                    <button
                      type="button"
                      disabled={!reachable}
                      onClick={() =>
                        document
                          .getElementById(step.id)
                          ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                      }
                      aria-current={current ? 'step' : undefined}
                      className={cn(
                        'group inline-flex min-h-11 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 sm:min-h-8',
                        current || done
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <StepNode
                        number={index + 1}
                        state={done ? 'done' : current ? 'current' : 'todo'}
                        small
                      />
                      {step.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </SheetHeader>

        <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <TrailStep
            id="run-step-choose"
            number={1}
            state={selected ? 'done' : 'current'}
            title="Choose a runbook"
            hint={selected ? undefined : 'Published runbooks you may run on this incident.'}
          >
            {selected ? (
              <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate">{selected.name}</span>
                  </p>
                  {selected.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {selected.description}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => setSelected(undefined)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <SearchField
                  id="adhoc-runbook-search"
                  aria-label="Search published runbooks"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search published runbooks…"
                  autoComplete="off"
                />
                <div className="flex min-h-4 items-center justify-between text-[11px] text-muted-foreground">
                  <span aria-live="polite">
                    {searching
                      ? 'Searching…'
                      : searched && !searchError
                        ? `${options.length} ${options.length === 1 ? 'runbook' : 'runbooks'}${options.length === 20 ? ' shown, refine to narrow' : ''}`
                        : ''}
                  </span>
                  {searching && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                </div>
                {searchError && (
                  <p role="alert" className="text-xs text-destructive">
                    {searchError}
                  </p>
                )}
                {searched && !searchError && !searching && options.length === 0 && (
                  <EmptyHint
                    icon={BookOpen}
                    title={query ? 'No matches' : 'Nothing to run yet'}
                    description={
                      query
                        ? 'No published runbooks match this search.'
                        : 'No published runbooks yet. Publish a runbook to run it from incidents.'
                    }
                    className="py-6"
                  />
                )}
                {options.length > 0 && (
                  <ul
                    aria-label="Published runbooks"
                    className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-card"
                  >
                    {options.map(option => (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => choose(option.id)}
                          disabled={loading}
                          className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <BookOpen className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{option.name}</span>
                              {option.version !== null && (
                                <Pill tone="success" className="shrink-0">
                                  v{option.version}
                                </Pill>
                              )}
                            </span>
                            {option.description && (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {option.description}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading runbook…
              </p>
            )}
            {loadError && (
              <p
                role="alert"
                className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300"
              >
                {loadError}
              </p>
            )}
          </TrailStep>
          <TrailStep
            id="run-step-configure"
            number={2}
            state={selected ? 'current' : 'todo'}
            title="Inputs and target"
            hint={selected ? undefined : 'Pick a runbook first.'}
          >
            {selected && (
              <section aria-label="Run configuration" className="space-y-3" key={selected.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="success">Published v{selected.version}</Pill>
                  {selected.hasWrite ? (
                    <Pill tone="warning" icon={ShieldAlert}>
                      Contains write actions
                    </Pill>
                  ) : (
                    <Pill>Read-only</Pill>
                  )}
                  {selected.requiresAgent && <Pill icon={Server}>Runs on an Agent</Pill>}
                </div>
                {selected.hasWrite && (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
                    <ShieldAlert
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                    This runbook can change systems. You must authorize the planned writes after
                    preview, and steps marked for approval wait for a responder with approval
                    rights.
                  </p>
                )}
                <form
                  ref={formRef}
                  className="grid gap-3 rounded-xl border bg-card p-4"
                  onChange={() => setRevision(value => value + 1)}
                  onSubmit={event => event.preventDefault()}
                >
                  {selected.inputs.length > 0 ? (
                    <InputFields definitions={selected.inputs} values={{}} />
                  ) : (
                    <p className="text-xs text-muted-foreground">This runbook takes no inputs.</p>
                  )}
                  {selected.requiresAgent ? (
                    <>
                      <RunbookTargetSelect {...targets} hasAgentWrite={selected.hasAgentWrite} />
                      <p className="text-xs text-muted-foreground">
                        This runbook has Agent-executed steps. Select an Agent or Agent pool;
                        preview fails closed when no target can be resolved.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      All steps run on the OpsKnight control plane. No Agent target is needed.
                    </p>
                  )}
                </form>
              </section>
            )}
          </TrailStep>
          <TrailStep
            id="run-step-review"
            number={3}
            state={selected ? 'current' : 'todo'}
            title="Review and run"
            hint={
              selected
                ? 'Preview builds the exact plan from these inputs. Change anything and it asks you to preview again.'
                : 'The plan appears here before anything runs.'
            }
          >
            {selected && (
              <RunbookExecutionPreview
                key={revision}
                previewAction={() => {
                  const fields = planFields(formRef.current);
                  previewed.current = fields;
                  const data = new FormData();
                  for (const [key, value] of fields) data.append(key, value);
                  return previewAdhocIncidentRunbookAction(incidentId, selected.id, data);
                }}
                executeAction={async data => {
                  const current = planFields(formRef.current);
                  if (JSON.stringify(current) !== JSON.stringify(previewed.current))
                    return { error: 'Inputs or target changed after preview. Preview again.' };
                  for (const [key, value] of previewed.current) data.append(key, value);
                  const result = await executeAdhocIncidentRunbookAction(
                    incidentId,
                    selected.id,
                    data
                  );
                  if (!result?.error) setOpen(false);
                  return result;
                }}
              />
            )}
          </TrailStep>
        </ol>
      </SheetContent>
    </Sheet>
  );
}

const RUN_STEPS = [
  { id: 'run-step-choose', label: 'Choose' },
  { id: 'run-step-configure', label: 'Configure' },
  { id: 'run-step-review', label: 'Review & run' },
] as const;

type StepState = 'done' | 'current' | 'todo';

function StepNode({ number, state, small }: { number: number; state: StepState; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums transition-colors',
        small ? 'h-5 w-5 text-2xs' : 'h-7 w-7 font-display text-xs',
        state === 'done'
          ? 'border-status-ok bg-status-ok text-white'
          : state === 'current'
            ? 'border-foreground bg-foreground text-background'
            : 'border-border bg-background text-muted-foreground'
      )}
    >
      {state === 'done' ? <Check className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : number}
    </span>
  );
}

/** One step of the run trail: a numbered node on a rail, then the step's content. */
function TrailStep({
  id,
  number,
  state,
  title,
  hint,
  children,
}: {
  id: string;
  number: number;
  state: StepState;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <li id={id} className="group/step grid scroll-mt-2 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        <StepNode number={number} state={state} />
        <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border group-last/step:hidden" />
      </div>
      <section aria-label={title} className="min-w-0 space-y-2.5 pb-6">
        <div className="pt-1">
          <h3
            className={cn(
              'text-sm font-semibold',
              state === 'todo' ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {title}
          </h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </section>
    </li>
  );
}
