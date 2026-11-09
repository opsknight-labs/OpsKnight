'use client';

import { useId, useMemo, useRef, useState, useTransition } from 'react';
import { previewOrchestrationAction } from '@/app/(app)/settings/intelligence/noise-controls/preview-actions';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  draftFromMatcher,
  emptyMatcher,
  moveItem,
  slugifyRuleId,
  validateMatcherDrafts,
  validateOrchestrationRules,
  type MatcherDraft,
} from '@/lib/intelligence/noise-controls/builders';
import {
  PREPAGING_LIMITS,
  type OrchestrationAction,
  type OrchestrationRule,
} from '@/lib/intelligence/noise-controls/contract';
import type { SimulationOutcome } from '@/lib/intelligence/noise-controls/simulation';
import { cn } from '@/lib/utils';
import MatcherRows from './MatcherRows';
import { fieldClass, ReplaySummary, touchButton, type Option } from './shared';

export const ACTION_TYPES = [
  { type: 'DROP', label: 'Drop (store nothing, never page)' },
  { type: 'SUPPRESS', label: 'Suppress (store, never page)' },
  { type: 'SET_URGENCY', label: 'Set urgency' },
  { type: 'SET_SEVERITY', label: 'Set severity' },
  { type: 'SET_LABEL', label: 'Set a label' },
  { type: 'REROUTE_SERVICE', label: 'Route to another service' },
  { type: 'ATTACH_RUNBOOK', label: 'Attach a runbook' },
  { type: 'ADD_NOTE', label: 'Add a note' },
] as const;
type ActionType = (typeof ACTION_TYPES)[number]['type'];

export interface ActionDraft {
  type: ActionType;
  value: string;
  key: string;
}

export interface RuleDraft {
  /** Stable React key; the rule id can change while typing. */
  uid: string;
  id: string;
  name: string;
  enabled: boolean;
  conditions: MatcherDraft[];
  actions: ActionDraft[];
}

function actionDraft(action: OrchestrationAction): ActionDraft {
  switch (action.type) {
    case 'SET_SEVERITY':
    case 'SET_URGENCY':
      return { type: action.type, value: action.value, key: '' };
    case 'SET_LABEL':
      return { type: action.type, value: action.value, key: action.key };
    case 'REROUTE_SERVICE':
      return { type: action.type, value: action.serviceId, key: '' };
    case 'ATTACH_RUNBOOK':
      return { type: action.type, value: action.runbookId, key: '' };
    case 'ADD_NOTE':
      return { type: action.type, value: action.text, key: '' };
    default:
      return { type: action.type, value: '', key: '' };
  }
}

export function ruleDraft(rule: OrchestrationRule, uid: string): RuleDraft {
  return {
    uid,
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    conditions: rule.conditions.map(draftFromMatcher),
    actions: rule.actions.map(actionDraft),
  };
}

function actionFromDraft(draft: ActionDraft): Record<string, unknown> {
  switch (draft.type) {
    case 'SET_SEVERITY':
    case 'SET_URGENCY':
      return { type: draft.type, value: draft.value.trim() };
    case 'SET_LABEL':
      return { type: draft.type, key: draft.key.trim(), value: draft.value.trim() };
    case 'REROUTE_SERVICE':
      return { type: draft.type, serviceId: draft.value };
    case 'ATTACH_RUNBOOK':
      return { type: draft.type, runbookId: draft.value.trim() };
    case 'ADD_NOTE':
      return { type: draft.type, text: draft.value.trim() };
    default:
      return { type: draft.type };
  }
}

/** Builder rows → the raw rule objects the policy form posts (the server validates them again). */
export function rulesFromDrafts(drafts: readonly RuleDraft[]): Array<Record<string, unknown>> {
  return drafts.map(draft => {
    const { matchers } = validateMatcherDrafts(draft.conditions);
    return {
      id: draft.id,
      name: draft.name.trim(),
      enabled: draft.enabled,
      conditions:
        matchers ??
        draft.conditions.map(condition => ({
          field: condition.field,
          ...(condition.field === 'label' ? { key: condition.key } : {}),
          op: condition.op,
          ...(condition.op === 'exists' ? {} : { value: condition.value }),
        })),
      actions: draft.actions.map(actionFromDraft),
    };
  });
}

function ActionRow({
  action,
  index,
  ruleName,
  services,
  runbooks,
  onChange,
  onRemove,
  canRemove,
}: {
  action: ActionDraft;
  index: number;
  ruleName: string;
  services: Option[];
  runbooks: Option[];
  onChange: (next: ActionDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const id = useId();
  const valueLabel: Partial<Record<ActionType, string>> = {
    SET_URGENCY: 'Urgency',
    SET_SEVERITY: 'Severity',
    SET_LABEL: 'Label value',
    REROUTE_SERVICE: 'Service',
    ATTACH_RUNBOOK: 'Runbook',
    ADD_NOTE: 'Note',
  };
  const label = valueLabel[action.type];
  return (
    <li className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))_auto] sm:items-end">
      <div className="space-y-1">
        <label htmlFor={`${id}-type`} className="text-xs font-medium">
          Action {index + 1}
        </label>
        <select
          id={`${id}-type`}
          value={action.type}
          onChange={event =>
            onChange({ type: event.target.value as ActionType, value: '', key: '' })
          }
          className={fieldClass}
        >
          {ACTION_TYPES.map(option => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {action.type === 'SET_LABEL' ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-key`} className="text-xs font-medium">
            Label key
          </label>
          <input
            id={`${id}-key`}
            value={action.key}
            onChange={event => onChange({ ...action, key: event.target.value })}
            className={fieldClass}
          />
        </div>
      ) : (
        <div aria-hidden="true" className="hidden sm:block" />
      )}
      {label ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-value`} className="text-xs font-medium">
            {label}
          </label>
          {action.type === 'SET_URGENCY' ? (
            <select
              id={`${id}-value`}
              value={action.value}
              onChange={event => onChange({ ...action, value: event.target.value })}
              className={fieldClass}
            >
              <option value="">Select</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          ) : action.type === 'REROUTE_SERVICE' ||
            (action.type === 'ATTACH_RUNBOOK' && runbooks.length > 0) ? (
            <select
              id={`${id}-value`}
              value={action.value}
              onChange={event => onChange({ ...action, value: event.target.value })}
              className={fieldClass}
            >
              <option value="">Select</option>
              {(action.type === 'REROUTE_SERVICE' ? services : runbooks).map(option => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${id}-value`}
              value={action.value}
              onChange={event => onChange({ ...action, value: event.target.value })}
              className={fieldClass}
            />
          )}
        </div>
      ) : (
        <div aria-hidden="true" className="hidden sm:block" />
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={touchButton}
        disabled={!canRemove}
        aria-label={`Remove action ${index + 1} from ${ruleName || 'this rule'}`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </li>
  );
}

/**
 * Ordered orchestration rules: first match wins for drop/suppress, transforms accumulate. Reorder with
 * the up/down buttons, by dragging the handle, or by focusing the handle and pressing ↑/↓. The rules are
 * posted as JSON in the policy form's `orchestration` field; "Test rules" replays them alone over the
 * last 7 days and shows how many incidents each matched.
 */
export default function OrchestrationRulesBuilder({
  name = 'orchestration',
  initialRules,
  services,
  runbooks = [],
  serviceId,
  canManage,
}: {
  name?: string;
  initialRules: OrchestrationRule[];
  services: Option[];
  runbooks?: Option[];
  /** The policy scope being edited, used to scope the replay. */
  serviceId: string | null;
  canManage: boolean;
}) {
  const id = useId();
  // Saved rules get index-based keys so server and client render the same ids.
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    initialRules.map((rule, index) => ruleDraft(rule, `saved-${index}`))
  );
  const added = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  const [replay, setReplay] = useState<SimulationOutcome | null>(null);
  const [replayError, setReplayError] = useState('');
  const [replaying, startReplay] = useTransition();
  const [dragging, setDragging] = useState<number | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  const raw = useMemo(() => rulesFromDrafts(rules), [rules]);
  const validation = useMemo(() => validateOrchestrationRules(raw), [raw]);

  const update = (index: number, patch: Partial<RuleDraft>) => {
    setRules(current => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
    setReplay(null);
  };

  const move = (from: number, to: number, focus = false) => {
    if (to < 0 || to >= rules.length || from === to) return;
    const rule = rules.at(from);
    if (!rule) return;
    setRules(current => moveItem(current, from, to));
    setAnnouncement(`Moved ${rule.name || 'rule'} to position ${to + 1} of ${rules.length}.`);
    setReplay(null);
    if (focus) requestAnimationFrame(() => handles.current.get(rule.uid)?.focus());
  };

  const addRule = () => {
    const taken = new Set(rules.map(rule => rule.id));
    setRules(current => [
      ...current,
      {
        uid: `new-${++added.current}`,
        id: slugifyRuleId(`rule ${current.length + 1}`, taken),
        name: '',
        enabled: true,
        conditions: [emptyMatcher()],
        actions: [{ type: 'SUPPRESS', value: '', key: '' }],
      },
    ]);
  };

  const runReplay = () => {
    if (!validation.rules || validation.rules.length === 0) {
      setReplayError('Fix the rules above before testing them.');
      return;
    }
    setReplayError('');
    startReplay(async () => {
      const response = await previewOrchestrationAction({ rules: validation.rules, serviceId });
      if (response.ok) setReplay(response.data);
      else setReplayError(response.message);
    });
  };

  return (
    <fieldset
      className="space-y-3 rounded-md border border-border p-3"
      aria-describedby={`${id}-help`}
    >
      <legend className="px-1 text-sm font-medium">Orchestration rules</legend>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Rules run top to bottom. The first drop or suppress wins; other actions accumulate. Reorder
        with the arrow buttons, by dragging the handle, or by focusing the handle and pressing ↑ or
        ↓.
      </p>
      <input type="hidden" name={name} value={JSON.stringify(raw)} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orchestration rules.</p>
      ) : (
        <ol className="space-y-3" aria-label="Orchestration rules in order">
          {rules.map((rule, index) => {
            const error = validation.errors.get(index);
            const label = rule.name || `Rule ${index + 1}`;
            const matched = replay?.matchedRules[rule.id];
            const decisive = replay?.bySource[rule.id];
            const conditionErrors = validateMatcherDrafts(rule.conditions).errors;
            return (
              <li
                key={rule.uid}
                onDragOver={event => {
                  if (dragging === null) return;
                  event.preventDefault();
                }}
                onDrop={event => {
                  event.preventDefault();
                  if (dragging !== null) move(dragging, index);
                  setDragging(null);
                }}
                className={cn(
                  'space-y-3 rounded-md border border-border bg-card p-3',
                  dragging === index && 'opacity-60',
                  !rule.enabled && 'border-dashed'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    draggable={canManage}
                    ref={element => {
                      if (element) handles.current.set(rule.uid, element);
                      else handles.current.delete(rule.uid);
                    }}
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = 'move';
                      setDragging(index);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onKeyDown={event => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        move(index, index - 1, true);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        move(index, index + 1, true);
                      }
                    }}
                    disabled={!canManage}
                    aria-label={`Reorder ${label}, position ${index + 1} of ${rules.length}`}
                    aria-roledescription="sortable handle"
                    className="flex h-11 w-11 cursor-grab items-center justify-center rounded-md border border-border text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9"
                  >
                    <span aria-hidden="true">⠿</span>
                  </button>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    #{index + 1}
                  </span>
                  <div className="min-w-[12rem] flex-1">
                    <label htmlFor={`${id}-${rule.uid}-name`} className="sr-only">
                      Name of rule {index + 1}
                    </label>
                    <input
                      id={`${id}-${rule.uid}-name`}
                      value={rule.name}
                      placeholder="Rule name"
                      maxLength={120}
                      disabled={!canManage}
                      onChange={event => {
                        const nextName = event.target.value;
                        const taken = new Set(
                          rules.filter((_, i) => i !== index).map(other => other.id)
                        );
                        update(index, {
                          name: nextName,
                          // Keep the id in step with the name until the rule has been saved once.
                          id: initialRules.some(saved => saved.id === rule.id)
                            ? rule.id
                            : slugifyRuleId(nextName || `rule ${index + 1}`, taken),
                        });
                      }}
                      className={fieldClass}
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={!canManage}
                      onChange={event => update(index, { enabled: event.target.checked })}
                      className="h-4 w-4"
                    />
                    Enabled
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={touchButton}
                      disabled={!canManage || index === 0}
                      aria-label={`Move ${label} up`}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={touchButton}
                      disabled={!canManage || index === rules.length - 1}
                      aria-label={`Move ${label} down`}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={touchButton}
                      disabled={!canManage}
                      aria-label={`Delete ${label}`}
                      onClick={() => {
                        setRules(current => current.filter((_, i) => i !== index));
                        setReplay(null);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Rule id <code>{rule.id}</code>
                  {replay && (
                    <>
                      {' '}
                      ·{' '}
                      <Badge variant={matched ? 'info' : 'outline'}>
                        Matched {matched ?? 0} incident{matched === 1 ? '' : 's'} in 7 days
                      </Badge>
                      {decisive ? ` (${decisive} dropped or suppressed)` : ''}
                    </>
                  )}
                </p>
                <MatcherRows
                  rows={rule.conditions}
                  max={PREPAGING_LIMITS.maxConditions}
                  legend="When all of these match"
                  errors={conditionErrors}
                  onChange={conditions => update(index, { conditions })}
                />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Then</legend>
                  <ol className="space-y-2">
                    {rule.actions.map((action, actionIndex) => (
                      <ActionRow
                        key={actionIndex}
                        action={action}
                        index={actionIndex}
                        ruleName={rule.name}
                        services={services}
                        runbooks={runbooks}
                        canRemove={canManage && rule.actions.length > 1}
                        onChange={next =>
                          update(index, {
                            actions: rule.actions.map((item, i) =>
                              i === actionIndex ? next : item
                            ),
                          })
                        }
                        onRemove={() =>
                          update(index, {
                            actions: rule.actions.filter((_, i) => i !== actionIndex),
                          })
                        }
                      />
                    ))}
                  </ol>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={touchButton}
                    disabled={!canManage || rule.actions.length >= PREPAGING_LIMITS.maxActions}
                    onClick={() =>
                      update(index, {
                        actions: [...rule.actions, { type: 'SET_URGENCY', value: '', key: '' }],
                      })
                    }
                  >
                    Add action
                  </Button>
                </fieldset>
                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {label}: {error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={touchButton}
          disabled={!canManage || rules.length >= PREPAGING_LIMITS.maxOrchestrationRules}
          onClick={addRule}
        >
          Add rule
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={touchButton}
          disabled={!canManage || replaying || rules.length === 0}
          onClick={runReplay}
        >
          {replaying ? 'Replaying…' : 'Test rules against the last 7 days'}
        </Button>
      </div>
      <div aria-live="polite" aria-busy={replaying}>
        {replayError && (
          <p role="alert" className="text-sm text-destructive">
            {replayError}
          </p>
        )}
        {replay && (
          <ReplaySummary
            outcome={replay}
            note="Only these rules were applied, in this order; other controls were off. Save the policy to keep the order."
          />
        )}
      </div>
    </fieldset>
  );
}
